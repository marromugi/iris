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

/** The bodies of the requests sent to the API, and the streams that answered them, in order. */
const exchanges: { request: unknown; response: Promise<string> }[] = [];
const model = createAnthropicModel(
  new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    fetch: async (url, init) => {
      const body = init?.body;
      const response = await fetch(url, init);
      const [forClient, forTest] = response.body?.tee() ?? [null, null];
      exchanges.push({
        request: typeof body === "string" ? JSON.parse(body) : body,
        response: new Response(forTest).text(),
      });
      return new Response(forClient, response);
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

/** What the API says it left out of a request: `input_transformations` from its `message_start`. */
function leftOut(stream: string): unknown {
  const start = stream
    .split("\n")
    .find((line) => line.startsWith("data:") && line.includes('"type":"message_start"'));
  return start === undefined
    ? "no message_start"
    : JSON.parse(start.slice("data:".length)).message.input_transformations;
}

test("the real model calls tools, gets its stored thinking back unchanged, and answers with the result", async () => {
  const conversation: Message[] = [
    {
      role: "user",
      text: "A shop sold 17 apples in the morning and 25 in the afternoon, then got 8 back as returns. Work out how many apples were sold in the end, using the add tool for each step (a negative number subtracts). Tell me the final number.",
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

  const responses = await Promise.all(exchanges.map((exchange) => exchange.response));
  console.log(JSON.stringify(conversation, null, 2));
  console.log("Left out per request:", JSON.stringify(responses.map(leftOut)));
  expect(heard).toContain("writing");
  expect(conversation).toContainEqual({
    role: "tool",
    callId: expect.any(String),
    isError: false,
    content: "34",
  });
  expect(nextAction(conversation).type).toBe("done");
  // The check is about thinking that went back, so a run where Claude didn't think proves nothing.
  const sentBack = JSON.stringify(exchanges.slice(1).map((exchange) => exchange.request));
  expect(sentBack).toContain('"type":"thinking"');
  // With the binding beta, the API lists any block it dropped; none should be.
  expect(responses.map(leftOut)).toEqual(responses.map(() => []));
});

const subtract = defineTool({
  name: "subtract",
  description: "Subtracts b from a and returns the difference.",
  input: z.object({ a: z.number(), b: z.number() }),
  async run({ a, b }) {
    return { ok: true, content: String(a - b) };
  },
});

test("when a run's tools change between steps, the real API leaves out the earlier thinking and carries on", async () => {
  const conversation: Message[] = [
    {
      role: "user",
      text: "A box held 17 apples and 25 more were put in. Use the add tool to work out how many it holds now, then tell me.",
    },
  ];
  // The first steps: Claude's call and the tool's result, stored.
  for (const _ of [1, 2]) {
    const message = await step({ model, tools: [add] }, conversation);
    if (message !== undefined) {
      conversation.push(stored(message));
    }
  }
  const thought = conversation.some(
    (message) =>
      message.role === "assistant" && message.parts.some((part) => part.type === "reasoning"),
  );

  // The next step is given one more tool, as when the user adds an agent while a run waits.
  const asked = exchanges.length;
  const reply = await step({ model, tools: [add, subtract] }, conversation);

  const response = await exchanges[asked]?.response;
  console.log(JSON.stringify(conversation, null, 2));
  console.log("Left out:", JSON.stringify(leftOut(response ?? "")));
  // The check is about thinking that was sent back, so a run where Claude didn't think proves nothing.
  expect(thought).toBe(true);
  expect(reply?.role).toBe("assistant");
  expect(leftOut(response ?? "")).toContainEqual(
    expect.objectContaining({ type: "thinking_dropped", reason: "prefix_binding_mismatch" }),
  );
});
