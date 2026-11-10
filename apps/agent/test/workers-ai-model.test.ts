import type { ModelProgress } from "@iris/agent";
import { expect, test } from "vitest";
import { type ChatCompletionStream, createWorkersAiModel } from "../src/workers-ai-model";

type Delta = Record<string, unknown>;

/**
 * Streams the deltas as Workers AI does: a chunk per delta, the last with the finish reason, then
 * one with only the usage and `data: [DONE]`. The text arrives in pieces of a few bytes, so a line
 * is split across reads. A null finish reason is a stream cut off: it stops before `[DONE]`.
 */
function completionStreaming(
  deltas: Delta[],
  finishReason: string | null = "stop",
  lines: { end: string; keepAlive: boolean; lastEnd: boolean } = {
    end: "\n",
    keepAlive: false,
    lastEnd: true,
  },
): { complete: ChatCompletionStream; inputs: Parameters<ChatCompletionStream>[0][] } {
  const inputs: Parameters<ChatCompletionStream>[0][] = [];
  const cutOff = finishReason === null;
  const chunk = (delta: Delta, finish: string | null) =>
    `data: ${JSON.stringify({
      object: "chat.completion.chunk",
      model: "@cf/zai-org/glm-4.7-flash",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}`;
  const events = [
    chunk({ role: "assistant", content: "", reasoning_content: null }, null),
    ...(lines.keepAlive ? ["data: "] : []),
    ...deltas.map((delta, index) =>
      chunk(delta, index === deltas.length - 1 && !cutOff ? finishReason : null),
    ),
    ...(cutOff
      ? []
      : [
          `data: ${JSON.stringify({ response: "", usage: { prompt_tokens: 16 } })}`,
          "data: [DONE]",
        ]),
  ];
  const separator = lines.end + lines.end;
  const text = events.join(separator) + (lines.lastEnd ? separator : "");
  const bytes = new TextEncoder().encode(text);
  const complete: ChatCompletionStream = async (input) => {
    inputs.push(input);
    return new ReadableStream({
      start(controller) {
        for (let start = 0; start < bytes.length; start += 7) {
          controller.enqueue(bytes.slice(start, start + 7));
        }
        controller.close();
      },
    });
  };
  return { complete, inputs };
}

test("sends the system prompt, the conversation and the tools in the chat completions format, streamed", async () => {
  const { complete, inputs } = completionStreaming([{ content: "OK" }]);

  await createWorkersAiModel(complete)({
    system: "Answer briefly.",
    messages: [
      { role: "user", text: "Weather in Osaka?" },
      {
        role: "assistant",
        parts: [
          { type: "text", text: "Checking." },
          { type: "tool-call", id: "c1", name: "forecast", input: { city: "Osaka" } },
        ],
      },
      { role: "tool", callId: "c1", isError: true, content: "The service is down." },
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

  expect(inputs).toEqual([
    {
      messages: [
        { role: "system", content: "Answer briefly." },
        { role: "user", content: "Weather in Osaka?" },
        {
          role: "assistant",
          content: "Checking.",
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "forecast", arguments: '{"city":"Osaka"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "c1", content: "Error: The service is down." },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "forecast",
            description: "Weather forecast for a city.",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        },
      ],
      stream: true,
    },
  ]);
});

test("puts the text and the tool calls together from their chunks, keeping arguments that aren't JSON as a string", async () => {
  const { complete, inputs } = completionStreaming(
    [
      { reasoning: "The user wants", reasoning_content: "The user wants" },
      { content: "Let me " },
      { content: "check." },
      {
        tool_calls: [
          { index: 0, id: "c1", function: { name: "forecast", arguments: '{"city":' } },
          { index: 1, id: "c2", function: { name: "forecast", arguments: "{city: Kyoto" } },
        ],
      },
      { tool_calls: [{ index: 0, function: { arguments: '"Osaka"}' } }] },
    ],
    "tool_calls",
  );

  const message = await createWorkersAiModel(complete)({
    system: undefined,
    messages: [{ role: "user", text: "Weather?" }],
    tools: [],
  });

  expect(inputs[0]).toEqual({ messages: [{ role: "user", content: "Weather?" }], stream: true });
  expect(message).toEqual({
    role: "assistant",
    parts: [
      { type: "text", text: "Let me check." },
      { type: "tool-call", id: "c1", name: "forecast", input: { city: "Osaka" } },
      { type: "tool-call", id: "c2", name: "forecast", input: "{city: Kyoto" },
    ],
  });
});

test("reports thinking once asked and while reasoning, then writing with the text so far", async () => {
  const { complete } = completionStreaming([
    { reasoning: "Hmm", reasoning_content: "Hmm" },
    { reasoning: " ok", reasoning_content: " ok" },
    { content: "Hel" },
    // Reasoning once the text has begun is part of writing it, not thinking again.
    { reasoning: "And", reasoning_content: "And" },
    { content: "lo." },
  ]);
  const heard: ModelProgress[] = [];

  await createWorkersAiModel(complete)({
    system: undefined,
    messages: [{ role: "user", text: "Hi" }],
    tools: [],
    onProgress: (progress) => heard.push(progress),
  });

  expect(heard).toEqual([
    { type: "thinking" },
    { type: "writing", text: "Hel" },
    { type: "writing", text: "Hello." },
  ]);
});

test("reads CRLF lines, a data line that carries nothing, and a last line without a newline", async () => {
  const { complete } = completionStreaming([{ content: "OK" }], "stop", {
    end: "\r\n",
    keepAlive: true,
    lastEnd: false,
  });

  const message = await createWorkersAiModel(complete)({
    system: undefined,
    messages: [{ role: "user", text: "Hi" }],
    tools: [],
  });

  expect(message).toEqual({ role: "assistant", parts: [{ type: "text", text: "OK" }] });
});

test("rejects a reply that stops before it finishes", async () => {
  const { complete } = completionStreaming([{ content: "Hel" }], null);

  await expect(
    createWorkersAiModel(complete)({
      system: undefined,
      messages: [{ role: "user", text: "Hi" }],
      tools: [],
    }),
  ).rejects.toThrow(
    "Workers AI model @cf/zai-org/glm-4.7-flash's reply stopped before it finished.",
  );
});

test("rejects an empty reply, but keeps a refusal as the assistant's text", async () => {
  const request = {
    system: undefined,
    messages: [{ role: "user" as const, text: "Hi" }],
    tools: [],
  };

  const empty = createWorkersAiModel(
    completionStreaming([{ reasoning: "Thinking", reasoning_content: "Thinking" }], "length")
      .complete,
  );
  await expect(empty(request)).rejects.toThrow(
    "Workers AI model @cf/zai-org/glm-4.7-flash returned an empty message (finish reason: length).",
  );

  const refusal = createWorkersAiModel(
    completionStreaming([{ refusal: "I can't help with that." }]).complete,
  );
  expect(await refusal(request)).toEqual({
    role: "assistant",
    parts: [{ type: "text", text: "I can't help with that." }],
  });
});
