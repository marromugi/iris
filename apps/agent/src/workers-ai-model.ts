import {
  type AssistantMessage,
  type JsonValue,
  jsonValueSchema,
  type Message,
  type Model,
  type ToolSpec,
} from "@iris/agent";

/** The Workers AI model every user's agent thinks with. */
export const WORKERS_AI_MODEL = "@cf/zai-org/glm-4.7-flash";

/** One chat completion call to a Workers AI model that takes and returns the OpenAI-style format. */
export type ChatCompletion = (input: {
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
}) => Promise<ChatCompletionsOutput>;

/**
 * A `Model` backed by a Workers AI chat completions model. The Workers AI format stays in this
 * module. Rejects when the call does, and when the reply has no message or an empty one (no
 * text, refusal or tool call, as when the model runs out of tokens while reasoning).
 */
export function createWorkersAiModel(complete: ChatCompletion): Model {
  return async (request) => {
    const output = await complete({
      messages: [
        ...(request.system === undefined
          ? []
          : [{ role: "system" as const, content: request.system }]),
        ...request.messages.map(toChatMessage),
      ],
      // Left out when empty: OpenAI-style APIs may reject an empty list of tools.
      ...(request.tools.length > 0 ? { tools: request.tools.map(toChatTool) } : {}),
    });
    const choice = output.choices[0];
    if (choice === undefined) {
      throw new Error(`Workers AI model ${output.model} returned no message.`);
    }
    const message = fromChatMessage(choice.message);
    if (message.parts.length === 0) {
      throw new Error(
        `Workers AI model ${output.model} returned an empty message (finish reason: ${choice.finish_reason}).`,
      );
    }
    return message;
  };
}

function toChatMessage(message: Message): ChatCompletionMessageParam {
  if (message.role === "user") {
    return { role: "user", content: message.text };
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

function fromChatMessage(message: ChatCompletionResponseMessage): AssistantMessage {
  const parts: AssistantMessage["parts"] = [];
  if (message.content !== null && message.content !== "") {
    parts.push({ type: "text", text: message.content });
  }
  if (message.refusal !== null && message.refusal !== "") {
    parts.push({ type: "text", text: message.refusal });
  }
  for (const call of message.tool_calls ?? []) {
    parts.push(
      call.type === "function"
        ? {
            type: "tool-call",
            id: call.id,
            name: call.function.name,
            input: parseArguments(call.function.arguments),
          }
        : { type: "tool-call", id: call.id, name: call.custom.name, input: call.custom.input },
    );
  }
  return { role: "assistant", parts };
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
