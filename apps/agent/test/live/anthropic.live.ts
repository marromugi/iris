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
      text: "A shop sold 17 apples in the morning and 25 in the afternoon, then got 8 back as returns. Work out how many apples were sold in the end, using the add tool for each step (a negative number subtracts). Tell me the final number.",
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

test("the real API takes a conversation another service's model wrote, with tool calls Claude wouldn't write", async () => {
  // As a thread's history from before the switch can be: blank text, a tool call ID Claude refuses,
  // an input that isn't an object, a result with nothing in it, and a reply of only blank text.
  const conversation: Message[] = [
    { role: "user", text: "Add 17 and 25 with the add tool." },
    {
      role: "assistant",
      parts: [
        { type: "text", text: "\n" },
        { type: "tool-call", id: "functions.add:0", name: "add", input: "17, 25" },
      ],
    },
    {
      role: "tool",
      callId: "functions.add:0",
      isError: true,
      content: 'The input for "add" is invalid: expected an object.',
    },
    {
      role: "assistant",
      parts: [{ type: "tool-call", id: "call.1", name: "add", input: { a: 17, b: 25 } }],
    },
    { role: "tool", callId: "call.1", isError: false, content: "" },
    { role: "assistant", parts: [{ type: "text", text: "The add tool returned nothing." }] },
    { role: "user", text: "Are you there?" },
    { role: "assistant", parts: [{ type: "text", text: "\n" }] },
    {
      role: "user",
      text: "Then work it out yourself: what is 17 + 25? Answer with just the number.",
    },
  ];

  const reply = await step({ model, tools: [add] }, conversation);

  console.log(JSON.stringify(reply, null, 2));
  expect(reply?.role).toBe("assistant");
  expect(JSON.stringify(reply)).toContain("42");
});

/** A system prompt that says a different time each time it is made, as the shared one once did. */
const systemAt = (time: string) =>
  `You are an agent in iris. Use tools when they help.\n\nCurrent time: ${time}.`;

test("when a run's system prompt changes between wake-ups, the real API leaves out the earlier thinking and carries on", async () => {
  const conversation: Message[] = [
    {
      role: "user",
      text: "A shop sold 17 apples in the morning and 25 in the afternoon, then got 8 back as returns. Work out how many apples were sold in the end, using the add tool for each step (a negative number subtracts). Tell me the final number.",
    },
  ];
  // The first wake-up: Claude's call and the tool's result, stored.
  const first = { model, tools: [add], system: systemAt("2026-11-13T08:00:00.000Z") };
  for (const _ of [1, 2]) {
    const message = await step(first, conversation);
    if (message !== undefined) {
      conversation.push(stored(message));
    }
  }
  const thought = conversation.some(
    (message) =>
      message.role === "assistant" && message.parts.some((part) => part.type === "reasoning"),
  );

  // A later wake-up carries the run on with the prompt made again at a later time.
  const asked = exchanges.length;
  const reply = await step(
    { model, tools: [add], system: systemAt("2026-11-13T08:01:30.000Z") },
    conversation,
  );

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

/** 32×32 PNGs of one color each. */
const RED_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR42mO4IyJCU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAJ3LED19/LmKAAAAAElFTkSuQmCC";
const BLUE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR42mMQ0bhDU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAHncYD2v4JFYAAAAAElFTkSuQmCC";

const bytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

test("the real model reads a post's images in order, with no text, and hears of one it wasn't given", async () => {
  const reply = await model({
    system:
      "For each image the user sent, in order, say its color in one English word, or 'missing' for one you weren't given. Write only the words, separated by commas.",
    messages: [
      {
        role: "user",
        text: "",
        images: [
          { type: "image", id: "red" },
          { type: "image", id: "gone" },
          { type: "image", id: "blue" },
        ],
      },
    ],
    tools: [],
    images: new Map([
      ["red", { mediaType: "image/png", bytes: bytes(RED_PNG) }],
      ["blue", { mediaType: "image/png", bytes: bytes(BLUE_PNG) }],
    ]),
  });

  const text = reply.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  console.log(JSON.stringify(exchanges.at(-1)?.request, null, 2).slice(0, 2000));
  console.log("Reply:", text);
  expect(text.toLowerCase()).toMatch(/red.*missing.*blue/s);
});
