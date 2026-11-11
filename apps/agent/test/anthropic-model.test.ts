import Anthropic from "@anthropic-ai/sdk";
import type { ModelProgress, ModelRequest } from "@iris/agent";
import { expect, test } from "vitest";
import { createAnthropicModel } from "../src/anthropic-model";

type Block =
  | { type: "thinking"; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "text"; text: string[] }
  | { type: "tool_use"; id: string; name: string; input: string };

/** One server-sent event of Claude's stream. */
const event = (data: { type: string } & Record<string, unknown>) =>
  `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;

/** The events of one content block, as the API streams it. */
function blockEvents(block: Block, index: number): string[] {
  const start = (contentBlock: Record<string, unknown>) =>
    event({ type: "content_block_start", index, content_block: contentBlock });
  const change = (delta: Record<string, unknown>) =>
    event({ type: "content_block_delta", index, delta });
  const stop = event({ type: "content_block_stop", index });
  if (block.type === "thinking") {
    return [
      start({ type: "thinking", thinking: "", signature: "" }),
      change({ type: "signature_delta", signature: block.signature }),
      stop,
    ];
  }
  if (block.type === "redacted_thinking") {
    return [start({ type: "redacted_thinking", data: block.data }), stop];
  }
  if (block.type === "text") {
    return [
      start({ type: "text", text: "" }),
      ...block.text.map((text) => change({ type: "text_delta", text })),
      stop,
    ];
  }
  return [
    start({ type: "tool_use", id: block.id, name: block.name, input: {} }),
    change({ type: "input_json_delta", partial_json: block.input }),
    stop,
  ];
}

/**
 * A client whose requests get Claude's stream of these blocks, as the API sends them: thinking with
 * its signature, text in the pieces given, and a tool call's input as one JSON string. Records each
 * request's headers and body.
 */
function claudeStreaming(
  blocks: Block[],
  stop: { reason: string; details?: { category: string; explanation: string } } = {
    reason: "end_turn",
  },
) {
  const requests: { headers: Headers; body: unknown }[] = [];
  const events = [
    event({
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 1 },
      },
    }),
    ...blocks.flatMap(blockEvents),
    event({
      type: "message_delta",
      delta: { stop_reason: stop.reason, stop_sequence: null, stop_details: stop.details ?? null },
      usage: { output_tokens: 30 },
    }),
    event({ type: "message_stop" }),
  ];
  const client = new Anthropic({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async (_url, init) => {
      const body = init?.body;
      requests.push({
        headers: new Headers(init?.headers),
        body: typeof body === "string" ? JSON.parse(body) : body,
      });
      return new Response(events.join(""), { headers: { "content-type": "text/event-stream" } });
    },
  });
  return { client, requests };
}

const ask = (text: string): ModelRequest => ({
  system: undefined,
  messages: [{ role: "user", text }],
  tools: [],
});

test("sends the system prompt, the conversation with Claude's thinking, and the tools as Claude takes them, streamed", async () => {
  // Another service's model wrote the second call: its ID and input are ones Claude refuses.
  const { client, requests } = claudeStreaming([{ type: "text", text: ["OK"] }]);

  await createAnthropicModel(client)({
    system: "Answer briefly.",
    messages: [
      { role: "user", text: "Weather in Osaka and Kobe?" },
      {
        role: "assistant",
        parts: [
          { type: "reasoning", data: { type: "thinking", thinking: "", signature: "s1" } },
          { type: "reasoning", data: { type: "redacted_thinking", data: "r1" } },
          { type: "reasoning", data: { reasoning_content: "another service's" } },
          { type: "text", text: "Checking." },
          { type: "text", text: " \n" },
          { type: "tool-call", id: "c1", name: "forecast", input: { city: "Osaka" } },
          { type: "tool-call", id: "functions.forecast:1", name: "forecast", input: "Kobe" },
        ],
      },
      { role: "tool", callId: "c1", isError: false, content: "" },
      {
        role: "tool",
        callId: "functions.forecast:1",
        isError: true,
        content: "The input isn't an object.",
      },
      { role: "assistant", parts: [{ type: "text", text: "Osaka is sunny." }] },
      { role: "user", text: "Thanks." },
    ],
    tools: [
      {
        name: "forecast",
        description: "Weather forecast for a city.",
        inputSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ],
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]?.headers.get("anthropic-beta")).toBe("thinking-binding-controls-2026-08-01");
  expect(requests[0]?.body).toEqual({
    model: "claude-haiku-5-5",
    max_tokens: 64_000,
    stream: true,
    thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
    output_config: { effort: "medium" },
    cache_control: { type: "ephemeral" },
    system: "Answer briefly.",
    messages: [
      { role: "user", content: "Weather in Osaka and Kobe?" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "", signature: "s1" },
          { type: "redacted_thinking", data: "r1" },
          { type: "text", text: "Checking." },
          { type: "tool_use", id: "c1", name: "forecast", input: { city: "Osaka" } },
          {
            type: "tool_use",
            id: "iris-66756e6374696f6e732e666f7265636173743a31",
            name: "forecast",
            input: {},
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "c1", is_error: false },
          {
            type: "tool_result",
            tool_use_id: "iris-66756e6374696f6e732e666f7265636173743a31",
            is_error: true,
            content: "The input isn't an object.",
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Osaka is sunny." }] },
      { role: "user", content: "Thanks." },
    ],
    tools: [
      {
        name: "forecast",
        description: "Weather forecast for a city.",
        input_schema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ],
  });
});

test("reports thinking, then writing as the text streams, and keeps Claude's thinking as reasoning where it came, leaving out blank text", async () => {
  const { client } = claudeStreaming(
    [
      { type: "thinking", signature: "s1" },
      { type: "text", text: ["Chec", "king."] },
      { type: "redacted_thinking", data: "r1" },
      { type: "text", text: [" "] },
      { type: "tool_use", id: "toolu_1", name: "forecast", input: '{"city":"Osaka"}' },
    ],
    { reason: "tool_use" },
  );
  const heard: ModelProgress[] = [];

  const message = await createAnthropicModel(client)({
    ...ask("Weather in Osaka?"),
    onProgress: (progress) => heard.push(progress),
  });

  expect(heard).toEqual([
    { type: "thinking" },
    { type: "writing", text: "Chec" },
    { type: "writing", text: "Checking." },
    { type: "writing", text: "Checking. " },
  ]);
  expect(message).toEqual({
    role: "assistant",
    parts: [
      { type: "reasoning", data: { type: "thinking", thinking: "", signature: "s1" } },
      { type: "text", text: "Checking." },
      { type: "reasoning", data: { type: "redacted_thinking", data: "r1" } },
      { type: "tool-call", id: "toolu_1", name: "forecast", input: { city: "Osaka" } },
    ],
  });
});

test("rejects a reply Claude declined, one cut off, and one with no text or tool call", async () => {
  const declined = claudeStreaming([], {
    reason: "refusal",
    details: { category: "cyber", explanation: "This could enable harm." },
  });
  await expect(createAnthropicModel(declined.client)(ask("Hi"))).rejects.toThrow(
    "Claude (claude-haiku-5-5) declined to reply (category: cyber). This could enable harm.",
  );

  const cutOff = claudeStreaming([{ type: "text", text: ["Once upon"] }], { reason: "max_tokens" });
  await expect(createAnthropicModel(cutOff.client)(ask("Hi"))).rejects.toThrow(
    "Claude (claude-haiku-5-5)'s reply stopped before it finished (stop reason: max_tokens).",
  );

  const onlyThinking = claudeStreaming([{ type: "thinking", signature: "s1" }]);
  await expect(createAnthropicModel(onlyThinking.client)(ask("Hi"))).rejects.toThrow(
    "Claude (claude-haiku-5-5) returned an empty message (stop reason: end_turn).",
  );
});
