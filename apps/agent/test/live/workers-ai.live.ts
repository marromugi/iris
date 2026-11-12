import { defineTool, type Message, type ModelProgress, nextAction, run } from "@iris/agent";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { z } from "zod";
import { createWorkersAiModel, WORKERS_AI_MODEL } from "../../src/workers-ai-model";

const model = createWorkersAiModel((input) => env.AI.run(WORKERS_AI_MODEL, input));

const add = defineTool({
  name: "add",
  description: "Adds two numbers and returns the sum.",
  input: z.object({ a: z.number(), b: z.number() }),
  async run({ a, b }) {
    return { ok: true, content: String(a + b) };
  },
});

test("the real model calls a tool and answers with its result", async () => {
  const conversation: Message[] = [
    { role: "user", text: "Use the add tool to add 17 and 25, then tell me the result." },
  ];

  const heard: ModelProgress["type"][] = [];
  const onProgress = (progress: ModelProgress) => heard.push(progress.type);
  for await (const message of run({ model, tools: [add] }, conversation, {
    maxSteps: 6,
    onProgress,
  })) {
    conversation.push(message);
  }

  console.log(JSON.stringify(conversation, null, 2));
  // Writing comes only from text the model streamed; thinking is reported as soon as it is asked.
  expect(heard).toContain("writing");
  expect(conversation).toContainEqual({
    role: "tool",
    callId: expect.any(String),
    isError: false,
    content: "42",
  });
  expect(nextAction(conversation).type).toBe("done");
});
