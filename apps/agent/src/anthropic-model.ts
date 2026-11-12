import type Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import {
  type AssistantMessage,
  type JsonObject,
  type JsonValue,
  jsonValueSchema,
  type Message,
  type Model,
  type ToolSpec,
} from "@iris/agent";
import { z } from "zod";

/** The Claude model every user's agent thinks with when the provider is Anthropic. */
export const ANTHROPIC_MODEL = "claude-haiku-5-5";

// Room for the model's thinking as well as its message; thinking counts toward the cap.
const MAX_TOKENS = 64_000;

// Lets the API drop a thinking block whose earlier conversation has changed, instead of failing
// the request: a run's system prompt and tools are made again each time it is carried on, and
// they change in between (the prompt carries the current time, and a tool's description names the
// user's agents).
const THINKING_BINDING_BETA = "thinking-binding-controls-2026-08-01";

// The IDs Claude takes for a tool call and its result.
const TOOL_CALL_ID = /^[a-zA-Z0-9_-]+$/;

/**
 * A `Model` backed by Claude through the Anthropic API, read as it streams: it reports thinking as
 * soon as it is asked and writing with the text so far. Claude's thinking comes back as reasoning
 * parts, in the order Claude wrote them, and goes back with the conversation as Claude needs it;
 * reasoning another service wrote is left out. Rejects when the API call or the stream does, when
 * Claude declines, when the reply stops for any reason other than finishing or calling tools, and
 * when the reply has no text or tool call.
 */
export function createAnthropicModel(client: Anthropic): Model {
  return async (request) => {
    request.onProgress?.({ type: "thinking" });
    const tools = request.tools.map(toAnthropicTool);
    const stream = client.beta.messages.stream({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      betas: [THINKING_BINDING_BETA],
      thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
      output_config: { effort: "medium" },
      // Caches the conversation so far; each step of a run sends it again with one more message.
      cache_control: { type: "ephemeral" },
      ...(request.system === undefined ? {} : { system: request.system }),
      messages: toAnthropicMessages(request.messages),
      ...(tools.length > 0 ? { tools } : {}),
    });
    let written = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        written += event.delta.text;
        request.onProgress?.({ type: "writing", text: written });
      }
    }
    const reply = await stream.finalMessage();
    if ((reply.input_transformations ?? []).length > 0) {
      console.warn(
        `Claude (${reply.model}) left out thinking it couldn't match to the conversation:`,
        JSON.stringify(reply.input_transformations),
      );
    }
    return toAssistantMessage(reply);
  };
}

// The reasoning parts this module writes: Claude's thinking blocks as the API returned them.
const thinkingBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thinking"), thinking: z.string(), signature: z.string() }),
  z.object({ type: z.literal("redacted_thinking"), data: z.string() }),
]);

function toAssistantMessage(reply: BetaMessage): AssistantMessage {
  if (reply.stop_reason === "refusal") {
    const details = reply.stop_details;
    throw new Error(
      `Claude (${reply.model}) declined to reply (category: ${details?.category ?? "none"}).${
        details?.explanation ? ` ${details.explanation}` : ""
      }`,
    );
  }
  if (reply.stop_reason !== "end_turn" && reply.stop_reason !== "tool_use") {
    throw new Error(
      `Claude (${reply.model})'s reply stopped before it finished (stop reason: ${reply.stop_reason}).`,
    );
  }
  const parts: AssistantMessage["parts"] = [];
  for (const block of reply.content) {
    switch (block.type) {
      case "thinking":
        parts.push({
          type: "reasoning",
          data: { type: "thinking", thinking: block.thinking, signature: block.signature },
        });
        break;
      case "redacted_thinking":
        parts.push({ type: "reasoning", data: { type: "redacted_thinking", data: block.data } });
        break;
      case "text":
        // Not kept when blank, since such a block isn't sent back.
        if (!isBlank(block.text)) {
          parts.push({ type: "text", text: block.text });
        }
        break;
      case "tool_use":
        parts.push({
          type: "tool-call",
          id: block.id,
          name: block.name,
          input: jsonValueSchema.parse(block.input),
        });
        break;
      default:
        throw new Error(
          `Claude (${reply.model}) returned a ${block.type} block, which iris never asks for.`,
        );
    }
  }
  if (!parts.some((part) => part.type !== "reasoning")) {
    throw new Error(
      `Claude (${reply.model}) returned an empty message (stop reason: ${reply.stop_reason}).`,
    );
  }
  return { role: "assistant", parts };
}

/** The conversation as Claude takes it: a tool call's results go back together in one user message. */
function toAnthropicMessages(messages: readonly Message[]): BetaMessageParam[] {
  const converted: BetaMessageParam[] = [];
  let results: BetaToolResultBlockParam[] | undefined;
  for (const message of messages) {
    if (message.role === "tool") {
      if (results === undefined) {
        results = [];
        converted.push({ role: "user", content: results });
      }
      results.push({
        type: "tool_result",
        tool_use_id: toolCallId(message.callId),
        is_error: message.isError,
        ...(message.content === "" ? {} : { content: message.content }),
      });
      continue;
    }
    results = undefined;
    converted.push(
      message.role === "user"
        ? { role: "user", content: message.text }
        : { role: "assistant", content: message.parts.flatMap(toAnthropicBlock) },
    );
  }
  return converted;
}

function toAnthropicBlock(part: AssistantMessage["parts"][number]): BetaContentBlockParam[] {
  if (part.type === "reasoning") {
    const thinking = thinkingBlockSchema.safeParse(part.data);
    return thinking.success ? [thinking.data] : [];
  }
  if (part.type === "text") {
    // The API refuses an empty text block, and a blank one says nothing.
    return isBlank(part.text) ? [] : [{ type: "text", text: part.text }];
  }
  return [
    { type: "tool_use", id: toolCallId(part.id), name: part.name, input: toolInput(part.input) },
  ];
}

function isBlank(text: string): boolean {
  return text.trim() === "";
}

/**
 * A tool call's ID as Claude takes it. Another service's model can write an ID Claude refuses,
 * such as an empty one; that ID goes as `iris-` and the hex of its UTF-8 bytes, the same for the
 * call and its result.
 */
function toolCallId(id: string): string {
  if (TOOL_CALL_ID.test(id)) {
    return id;
  }
  const hex = [...new TextEncoder().encode(id)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `iris-${hex}`;
}

/**
 * Claude takes a tool call's input only as an object. Another service's model can write other
 * input, which its tool then rejected; such a call goes to Claude with an empty input, and its
 * result says what was wrong.
 */
function toolInput(input: JsonValue): JsonObject {
  return isJsonObject(input) ? input : {};
}

// A type guard, since `Array.isArray` doesn't narrow away a readonly array type.
function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toAnthropicTool(tool: ToolSpec): BetaTool {
  const { $schema: _dialect, ...schema } = tool.inputSchema;
  if (schema.type !== "object") {
    throw new Error(
      `Tool "${tool.name}" takes ${String(schema.type)} input; Claude's tools take an object.`,
    );
  }
  return {
    name: tool.name,
    description: tool.description,
    input_schema: { ...schema, type: "object" },
  };
}
