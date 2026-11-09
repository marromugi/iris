import type { AssistantMessage } from "@iris/agent";
import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import { RETRY_DELAY_MS, runDue } from "../src/runner";
import * as store from "../src/store";
import { scriptedModel, testAgent, type UserAgent } from "./worker";

afterEach(async () => {
  scriptedModel.length = 0;
  await reset();
});

const userAgent = () => (env.USER_AGENT as DurableObjectNamespace<UserAgent>).getByName("user-1");

const reply = (text: string): AssistantMessage => ({
  role: "assistant",
  parts: [{ type: "text", text }],
});

const dailyAtEightUtc = { cron: "0 8 * * *", timeZone: "UTC" };

/** Puts a task straight into storage with its alarm, so a test can choose a next run time in the past. */
function insertTask(nextRunAt: Date) {
  return runInDurableObject(userAgent(), async (_, state) => {
    store.insertTask(state.storage, {
      id: "task-1",
      prompt: "Summarize today's email",
      schedule: dailyAtEightUtc,
      nextRunAt,
    });
    await state.storage.setAlarm(nextRunAt);
  });
}

test("adds a task and sets the alarm to its next run time", async () => {
  const agent = userAgent();

  const added = await agent.addTask({
    prompt: "Summarize today's email",
    schedule: { cron: "0 8 * * *", timeZone: "Asia/Tokyo" },
  });

  expect(added.ok).toBe(true);
  const tasks = await agent.listTasks();
  expect(tasks.map((task) => [task.prompt, task.schedule])).toEqual([
    ["Summarize today's email", { cron: "0 8 * * *", timeZone: "Asia/Tokyo" }],
  ]);
  const alarm = await runInDurableObject(agent, (_, state) => state.storage.getAlarm());
  expect(alarm).toBe(tasks[0]?.nextRunAt.getTime());
});

test("returns an invalid schedule as an error and adds nothing", async () => {
  const agent = userAgent();

  const added = await agent.addTask({
    prompt: "Summarize today's email",
    schedule: { cron: "0 8 * * *", timeZone: "Mars/Olympus" },
  });

  expect(added).toEqual({
    ok: false,
    error: "✖ Not a known IANA time zone.\n  → at schedule.timeZone",
  });
  expect(await agent.listTasks()).toEqual([]);
});

test("removing the last task clears the alarm", async () => {
  const agent = userAgent();
  const added = await agent.addTask({ prompt: "Check stocks", schedule: dailyAtEightUtc });
  if (!added.ok) {
    throw new Error(added.error);
  }

  expect(await agent.removeTask(added.task.id)).toBe(true);

  expect(await agent.listTasks()).toEqual([]);
  expect(await runInDurableObject(agent, (_, state) => state.storage.getAlarm())).toBeNull();
});

test("when the alarm fires, runs the due task and saves its conversation", async () => {
  await insertTask(new Date(Date.now() - 60_000));
  scriptedModel.push(reply("You have 3 new emails."));

  expect(await runDurableObjectAlarm(userAgent())).toBe(true);

  const runs = await userAgent().recentRuns();
  expect(runs).toHaveLength(1);
  expect(runs[0]?.messages).toEqual([
    { role: "user", text: "Summarize today's email" },
    reply("You have 3 new emails."),
  ]);
  expect(runs[0]?.endedAt).not.toBeNull();
  const [task] = await userAgent().listTasks();
  expect(task?.nextRunAt.getTime()).toBeGreaterThan(Date.now());
});

test("a failed run is tried again later and carried on, not started again", async () => {
  const startedAt = new Date("2026-11-10T08:00:00Z");
  await insertTask(startedAt);
  scriptedModel.push(new Error("The model service is unreachable."));

  const wakeAt = await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => startedAt),
  );

  expect(wakeAt).toEqual(new Date(startedAt.getTime() + RETRY_DELAY_MS));
  const [failed] = await userAgent().recentRuns();
  expect(failed?.lastError).toBe("The model service is unreachable.");
  expect(failed?.endedAt).toBeNull();

  scriptedModel.push(reply("You have 3 new emails."));
  const retryAt = new Date(startedAt.getTime() + RETRY_DELAY_MS);
  await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => retryAt),
  );

  const runs = await userAgent().recentRuns();
  expect(runs).toHaveLength(1);
  expect(runs[0]?.messages).toEqual([
    { role: "user", text: "Summarize today's email" },
    reply("You have 3 new emails."),
  ]);
  expect(runs[0]?.lastError).toBeNull();
  expect(runs[0]?.endedAt).toEqual(retryAt);
});

test("a task that missed several times runs once and moves to its next time after now", async () => {
  await insertTask(new Date("2026-11-07T08:00:00Z"));
  scriptedModel.push(reply("Done."));
  const now = new Date("2026-11-10T09:30:00Z");

  const wakeAt = await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => now),
  );

  expect(await userAgent().recentRuns()).toHaveLength(1);
  expect(wakeAt).toEqual(new Date("2026-11-11T08:00:00Z"));
  const [task] = await userAgent().listTasks();
  expect(task?.nextRunAt).toEqual(new Date("2026-11-11T08:00:00Z"));
});
