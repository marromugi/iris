import { expect, test } from "vitest";
import { type ChatCompletion, createWorkersAiModel } from "../src/workers-ai-model";

function completionReturning(
  message: ChatCompletionResponseMessage,
  finishReason: ChatCompletionChoice["finish_reason"] = "stop",
): {
  complete: ChatCompletion;
  inputs: Parameters<ChatCompletion>[0][];
} {
  const inputs: Parameters<ChatCompletion>[0][] = [];
  const complete: ChatCompletion = async (input) => {
    inputs.push(input);
    return {
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 0,
      model: "@cf/zai-org/glm-4.7-flash",
      choices: [{ index: 0, message, finish_reason: finishReason, logprobs: null }],
    };
  };
  return { complete, inputs };
}

const plainReply: ChatCompletionResponseMessage = {
  role: "assistant",
  content: "OK",
  refusal: null,
};

test("sends the system prompt, the conversation and the tools in the chat completions format", async () => {
  const { complete, inputs } = completionReturning(plainReply);

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
    },
  ]);
});

test("leaves out tools when there are none, and turns the reply into an assistant message, keeping arguments that aren't JSON as a string", async () => {
  const { complete, inputs } = completionReturning({
    role: "assistant",
    content: "Let me check.",
    refusal: null,
    tool_calls: [
      { id: "c1", type: "function", function: { name: "forecast", arguments: '{"city":"Osaka"}' } },
      { id: "c2", type: "function", function: { name: "forecast", arguments: "{city: Kyoto" } },
    ],
  });

  const message = await createWorkersAiModel(complete)({
    system: undefined,
    messages: [{ role: "user", text: "Weather?" }],
    tools: [],
  });

  expect(inputs[0]).toEqual({ messages: [{ role: "user", content: "Weather?" }] });
  expect(message).toEqual({
    role: "assistant",
    parts: [
      { type: "text", text: "Let me check." },
      { type: "tool-call", id: "c1", name: "forecast", input: { city: "Osaka" } },
      { type: "tool-call", id: "c2", name: "forecast", input: "{city: Kyoto" },
    ],
  });
});

test("rejects an empty reply, but keeps a refusal as the assistant's text", async () => {
  const request = {
    system: undefined,
    messages: [{ role: "user" as const, text: "Hi" }],
    tools: [],
  };

  const empty = createWorkersAiModel(
    completionReturning({ role: "assistant", content: null, refusal: null }, "length").complete,
  );
  await expect(empty(request)).rejects.toThrow(
    "Workers AI model @cf/zai-org/glm-4.7-flash returned an empty message (finish reason: length).",
  );

  const refusal = createWorkersAiModel(
    completionReturning({ role: "assistant", content: null, refusal: "I can't help with that." })
      .complete,
  );
  expect(await refusal(request)).toEqual({
    role: "assistant",
    parts: [{ type: "text", text: "I can't help with that." }],
  });
});
