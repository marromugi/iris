import {
  type AssistantMessage,
  type JsonValue,
  jsonValueSchema,
  type Message,
  type Model,
  type ModelProgress,
  type ToolSpec,
  UNREAD_IMAGE_TEXT,
} from "@iris/agent";
import { z } from "zod";

/** The Workers AI model every user's agent thinks with when the provider is Workers AI. */
export const WORKERS_AI_MODEL = "@cf/zai-org/glm-4.7-flash";

/**
 * One streamed chat completion call to a Workers AI model that takes and returns the OpenAI-style
 * format. The stream is server-sent events: `data: ` lines of chunks, ending with `data: [DONE]`.
 */
export type ChatCompletionStream = (input: {
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  stream: true;
}) => Promise<ReadableStream>;

/**
 * A `Model` backed by a Workers AI chat completions model, read as it streams: it reports
 * thinking as soon as it is asked and while the model reasons, and writing with the text so far.
 * The Workers AI format stays in this module. Rejects when the call or the stream does, on a chunk
 * it can't read, when the stream ends before a finish reason (cut off), and when the reply has no
 * message or an empty one (no text, refusal or tool call, as when the model runs out of tokens
 * while reasoning).
 */
export function createWorkersAiModel(complete: ChatCompletionStream): Model {
  return async (request) => {
    const report = progressReporter(request.onProgress);
    report({ type: "thinking" });
    const stream = await complete({
      messages: [
        ...(request.system === undefined
          ? []
          : [{ role: "system" as const, content: request.system }]),
        ...request.messages.map(toChatMessage),
      ],
      // Left out when empty: OpenAI-style APIs may reject an empty list of tools.
      ...(request.tools.length > 0 ? { tools: request.tools.map(toChatTool) } : {}),
      stream: true,
    });
    const reply = new Reply();
    for await (const chunk of chunks(stream)) {
      reply.add(chunk, report);
    }
    return reply.message();
  };
}

/** Passes progress on, leaving out a report of thinking right after another. */
function progressReporter(onProgress: ((progress: ModelProgress) => void) | undefined) {
  let thinking = false;
  return (progress: ModelProgress) => {
    if (progress.type === "thinking" && thinking) {
      return;
    }
    thinking = progress.type === "thinking";
    onProgress?.(progress);
  };
}

// The part of a chunk this module reads. A chunk without choices, such as the last one with only
// the usage, adds nothing.
const chunkSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullish(),
            refusal: z.string().nullish(),
            reasoning: z.string().nullish(),
            reasoning_content: z.string().nullish(),
            tool_calls: z
              .array(
                z.object({
                  index: z.number(),
                  id: z.string().nullish(),
                  function: z
                    .object({ name: z.string().nullish(), arguments: z.string().nullish() })
                    .nullish(),
                }),
              )
              .nullish(),
          })
          .nullish(),
        finish_reason: z.string().nullish(),
      }),
    )
    .optional(),
});

type Chunk = z.infer<typeof chunkSchema>;

/** The chunks of a server-sent events stream, until `[DONE]` or the stream's end. */
async function* chunks(stream: ReadableStream): AsyncGenerator<Chunk, void, undefined> {
  let buffered = "";
  for await (const text of stream.pipeThrough(new TextDecoderStream())) {
    buffered += text;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      const data = dataOf(line);
      if (data === "[DONE]") {
        return;
      }
      if (data !== undefined) {
        yield chunkSchema.parse(JSON.parse(data));
      }
    }
  }
  const data = dataOf(buffered);
  if (data !== undefined && data !== "[DONE]") {
    yield chunkSchema.parse(JSON.parse(data));
  }
}

/** What a `data:` line carries; undefined for any other line of the stream, or one that carries nothing. */
function dataOf(line: string): string | undefined {
  const trimmed = line.trim();
  const data = trimmed.startsWith("data:") ? trimmed.slice("data:".length).trim() : "";
  return data === "" ? undefined : data;
}

/** The assistant's message as its chunks add up. */
class Reply {
  private model = WORKERS_AI_MODEL;
  private choices = 0;
  private text = "";
  private refusal = "";
  private readonly calls = new Map<number, { id: string; name: string; arguments: string }>();
  private finishReason: string | undefined;

  add(chunk: Chunk, report: (progress: ModelProgress) => void): void {
    this.model = chunk.model ?? this.model;
    const choice = chunk.choices?.[0];
    if (choice === undefined) {
      return;
    }
    this.choices += 1;
    this.finishReason = choice.finish_reason ?? this.finishReason;
    const delta = choice.delta;
    // Thinking means nothing of this message is written yet; reasoning after the text has begun is
    // part of writing it.
    if ((delta?.reasoning || delta?.reasoning_content) && this.text === "" && this.refusal === "") {
      report({ type: "thinking" });
    }
    if (delta?.content || delta?.refusal) {
      this.text += delta.content ?? "";
      this.refusal += delta.refusal ?? "";
      report({
        type: "writing",
        text: [this.text, this.refusal].filter((t) => t !== "").join("\n"),
      });
    }
    for (const call of delta?.tool_calls ?? []) {
      const sofar = this.calls.get(call.index) ?? { id: "", name: "", arguments: "" };
      this.calls.set(call.index, {
        id: call.id ?? sofar.id,
        name: call.function?.name ?? sofar.name,
        arguments: sofar.arguments + (call.function?.arguments ?? ""),
      });
    }
  }

  message(): AssistantMessage {
    if (this.choices === 0) {
      throw new Error(`Workers AI model ${this.model} returned no message.`);
    }
    if (this.finishReason === undefined) {
      throw new Error(`Workers AI model ${this.model}'s reply stopped before it finished.`);
    }
    const parts: AssistantMessage["parts"] = [];
    for (const text of [this.text, this.refusal]) {
      if (text !== "") {
        parts.push({ type: "text", text });
      }
    }
    for (const [, call] of [...this.calls].toSorted(([a], [b]) => a - b)) {
      parts.push({
        type: "tool-call",
        id: call.id,
        name: call.name,
        input: parseArguments(call.arguments),
      });
    }
    if (parts.length === 0) {
      throw new Error(
        `Workers AI model ${this.model} returned an empty message (finish reason: ${this.finishReason}).`,
      );
    }
    return { role: "assistant", parts };
  }
}

function toChatMessage(message: Message): ChatCompletionMessageParam {
  if (message.role === "user") {
    // This model doesn't read images; each is given as text, in the order they were sent.
    const images = (message.images ?? []).map(() => UNREAD_IMAGE_TEXT);
    return {
      role: "user",
      content: [...images, message.text].filter((text) => text !== "").join("\n"),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.callId,
      content: message.isError ? `Error: ${message.content}` : message.content,
    };
  }
  const text = message.parts.flatMap((part) => (part.type === "text" ? [part.text] : []));
  const toolCalls = message.parts.flatMap((part) =>
    part.type === "tool-call"
      ? [
          {
            id: part.id,
            type: "function" as const,
            function: { name: part.name, arguments: JSON.stringify(part.input) },
          },
        ]
      : [],
  );
  return {
    role: "assistant",
    content: text.length > 0 ? text.join("\n") : null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

function toChatTool(tool: ToolSpec): ChatCompletionTool {
  const { $schema: _dialect, ...parameters } = tool.inputSchema;
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters },
  };
}

/**
 * Arguments that aren't valid JSON are passed on as the raw string, so the tool's schema rejects
 * them and the model sees why, instead of the whole run failing.
 */
function parseArguments(text: string): JsonValue {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return text;
  }
  return jsonValueSchema.parse(value);
}
