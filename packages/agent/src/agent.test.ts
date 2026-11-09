import { expect, test } from "vitest";
import { z } from "zod";
import { type Agent, nextAction, run } from "./agent";
import type { AssistantMessage, Message } from "./message";
import type { Model, ModelRequest } from "./model";
import { defineTool } from "./tool";

async function collect(messages: AsyncIterable<Message>): Promise<Message[]> {
  const collected: Message[] = [];
  for await (const message of messages) {
    collected.push(message);
  }
  return collected;
}

function scriptedModel(replies: readonly AssistantMessage[]): {
  model: Model;
  requests: ModelRequest[];
} {
  const requests: ModelRequest[] = [];
  const model: Model = async (request) => {
    requests.push(request);
    const next = replies[requests.length - 1];
    if (next === undefined) {
      throw new Error("The model was called more times than the test scripted.");
    }
    return next;
  };
  return { model, requests };
}

const user = (text: string): Message => ({ role: "user", text });

const reply = (text: string): AssistantMessage => ({
  role: "assistant",
  parts: [{ type: "text", text }],
});

const call = (id: string, name: string, input: unknown) =>
  ({ type: "tool-call", id, name, input }) as const;

const forecast = defineTool({
  name: "forecast",
  description: "Weather forecast for a city.",
  input: z.object({
    city: z.string().min(1),
    days: z.int().min(1).max(7).default(1),
  }),
  async run({ city, days }) {
    if (city === "Atlantis") {
      return { ok: false, error: "There is no forecast for Atlantis." };
    }
    return { ok: true, content: `${city}: sunny for ${days} day(s)` };
  },
});

test("ends when the assistant replies without calling a tool", async () => {
  const { model } = scriptedModel([reply("Hello!")]);

  const added = await collect(run({ model, tools: [] }, [user("Hi")]));

  expect(added).toEqual([reply("Hello!")]);
});

test("runs a called tool with its parsed input and sends the result back to the model", async () => {
  const askForecast: AssistantMessage = {
    role: "assistant",
    parts: [{ type: "text", text: "Checking." }, call("c1", "forecast", { city: "Tokyo" })],
  };
  const { model, requests } = scriptedModel([askForecast, reply("Sunny in Tokyo.")]);

  const added = await collect(run({ model, tools: [forecast] }, [user("Weather in Tokyo?")]));

  expect(added).toEqual([
    askForecast,
    {
      role: "tool",
      results: [{ callId: "c1", isError: false, content: "Tokyo: sunny for 1 day(s)" }],
    },
    reply("Sunny in Tokyo."),
  ]);
  expect(requests[1]?.messages).toEqual([user("Weather in Tokyo?"), ...added.slice(0, 2)]);
});

test("gives the model the system prompt and each tool's input as JSON Schema", async () => {
  const { model, requests } = scriptedModel([reply("Hi.")]);
  const agent: Agent = { model, tools: [forecast], system: "Answer briefly." };

  await collect(run(agent, [user("Hi")]));

  expect(requests[0]?.system).toBe("Answer briefly.");
  expect(requests[0]?.tools).toEqual([
    {
      name: "forecast",
      description: "Weather forecast for a city.",
      inputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          city: { type: "string", minLength: 1 },
          days: { default: 1, type: "integer", minimum: 1, maximum: 7 },
        },
        required: ["city"],
      },
    },
  ]);
});

test("turns failed tool calls into error results for the model, in call order", async () => {
  const { model } = scriptedModel([
    {
      role: "assistant",
      parts: [
        call("c1", "translate", { text: "hi" }),
        call("c2", "forecast", { city: "", days: 9 }),
        call("c3", "forecast", { city: "Atlantis" }),
      ],
    },
    reply("Sorry, I couldn't."),
  ]);

  const added = await collect(run({ model, tools: [forecast] }, [user("Help")]));

  expect(added[1]).toEqual({
    role: "tool",
    results: [
      { callId: "c1", isError: true, content: 'There is no tool named "translate".' },
      {
        callId: "c2",
        isError: true,
        content: [
          'The input for "forecast" is invalid:',
          "✖ Too small: expected string to have >=1 characters",
          "  → at city",
          "✖ Too big: expected number to be <=7",
          "  → at days",
        ].join("\n"),
      },
      { callId: "c3", isError: true, content: "There is no forecast for Atlantis." },
    ],
  });
});

test("stops after maxSteps, and a later run continues the saved conversation", async () => {
  const askForecast: AssistantMessage = {
    role: "assistant",
    parts: [call("c1", "forecast", { city: "Osaka", days: 2 })],
  };
  const { model } = scriptedModel([askForecast, reply("Sunny in Osaka.")]);
  const agent: Agent = { model, tools: [forecast] };
  const conversation: Message[] = [user("Weather in Osaka?")];

  for await (const message of run(agent, conversation, { maxSteps: 1 })) {
    conversation.push(message);
  }
  expect(conversation).toEqual([user("Weather in Osaka?"), askForecast]);
  expect(nextAction(conversation).type).toBe("run-tools");

  for await (const message of run(agent, conversation)) {
    conversation.push(message);
  }
  expect(conversation.slice(2)).toEqual([
    {
      role: "tool",
      results: [{ callId: "c1", isError: false, content: "Osaka: sunny for 2 day(s)" }],
    },
    reply("Sunny in Osaka."),
  ]);
  expect(nextAction(conversation).type).toBe("done");
});
