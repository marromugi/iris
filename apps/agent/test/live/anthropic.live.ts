import Anthropic from "@anthropic-ai/sdk";
import {
  defineTool,
  type Message,
  type ModelProgress,
  messageSchema,
  nextAction,
  step,
} from "@iris/agent";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { z } from "zod";
import { createAnthropicModel } from "../../src/anthropic-model";

// Calls the real Claude API with ANTHROPIC_API_KEY (from .dev.vars or the environment), which is
// charged to that key's account.

/** The bodies of the requests sent to the API, in order. */
const requestBodies: unknown[] = [];
const model = createAnthropicModel(
  new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    fetch: async (url, init) => {
      const body = init?.body;
      requestBodies.push(typeof body === "string" ? JSON.parse(body) : body);
      return fetch(url, init);
    },
  }),
);

const add = defineTool({
  name: "add",
  description: "Adds two numbers and returns the sum.",
  input: z.object({ a: z.number(), b: z.number() }),
  async run({ a, b }) {
    return { ok: true, content: String(a + b) };
  },
});

/** A message as storage gives it back: written as JSON and parsed again. */
const stored = (message: Message): Message =>
  messageSchema.parse(JSON.parse(JSON.stringify(message)));

test("the real model calls tools, reads its stored thinking back, and answers with the result", async () => {
  const conversation: Message[] = [
    {
      role: "user",
      text: "Use the add tool to add 17 and 25, then use it again to add 8 to that sum. Tell me the final result.",
    },
  ];
  const heard: ModelProgress["type"][] = [];
  const onProgress = (progress: ModelProgress) => heard.push(progress.type);

  // Step by step, each message stored before the next step, as a run carried on from storage is.
  for (let count = 0; count < 10 && nextAction(conversation).type !== "done"; count += 1) {
    const message = await step({ model, tools: [add] }, conversation, onProgress);
    if (message === undefined) {
      break;
    }
    conversation.push(stored(message));
  }

  console.log(JSON.stringify(conversation, null, 2));
  expect(heard).toContain("writing");
  expect(conversation).toContainEqual({
    role: "tool",
    callId: expect.any(String),
    isError: false,
    content: "50",
  });
  expect(nextAction(conversation).type).toBe("done");
  // Thinking is up to the model; when it thought before a tool call, that thinking went back.
  const thought = conversation.some(
    (message) =>
      message.role === "assistant" &&
      message.parts.some((part) => part.type === "reasoning") &&
      message !== conversation.at(-1),
  );
  const sentBack = JSON.stringify(requestBodies.slice(1)).includes('"type":"thinking"');
  console.log(`Thought before a tool call: ${thought}; thinking sent back: ${sentBack}`);
  expect(sentBack).toBe(thought);
});
