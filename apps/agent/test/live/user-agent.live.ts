import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import * as store from "../../src/store";
import { agentThread } from "../agent-thread";

// Goes through the Worker's own wiring, so the model is the one MODEL_PROVIDER names.

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
  console.log(
    `MODEL_PROVIDER: ${env.MODEL_PROVIDER}; ANTHROPIC_API_KEY is "invalid": ${env.ANTHROPIC_API_KEY === "invalid"}`,
    JSON.stringify(latest, null, 2),
  );
  expect(latest?.lastError).toBeNull();
  expect(latest?.endedAt).not.toBeNull();
  expect(latest?.messages.at(-1)?.role).toBe("assistant");
});
