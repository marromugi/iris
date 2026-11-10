import { defineTool, type Message, type ModelProgress, nextAction, run } from "@iris/agent";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { z } from "zod";
import * as store from "../../src/store";
import { createWorkersAiModel, WORKERS_AI_MODEL } from "../../src/workers-ai-model";
import { agentThread } from "../agent-thread";

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

test("a due task runs through the user agent's alarm on the real model", async () => {
  const agent = env.USER_AGENT.getByName("live-check");
  const dueAt = new Date(Date.now() - 60_000);
  const [first] = await agent.listAgents();
  if (first === undefined) {
    throw new Error("The user has no agent.");
  }
  const agentId = first.id;
  await runInDurableObject(agent, async (_, state) => {
    store.insertTask(state.storage, {
      id: "live-check",
      agentId,
      threadId: agentThread(state.storage, agentId),
      prompt: "Reply with one short sentence saying hello.",
      schedule: { cron: "0 8 * * *", timeZone: "UTC" },
      nextRunAt: dueAt,
    });
    await state.storage.setAlarm(dueAt);
  });

  expect(await runDurableObjectAlarm(agent)).toBe(true);

  const [latest] = (await agent.recentRuns(agentId, 1)) ?? [];
  console.log(JSON.stringify(latest, null, 2));
  expect(latest?.lastError).toBeNull();
  expect(latest?.endedAt).not.toBeNull();
  expect(latest?.messages.at(-1)?.role).toBe("assistant");
});
