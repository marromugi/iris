import type { AssistantMessage } from "@iris/agent";
import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import { MAX_FAILED_ATTEMPTS, RETRY_DELAY_MS, runNext } from "../src/runner";
import * as store from "../src/store";
import { scriptedModel, testAgent } from "./worker";

afterEach(async () => {
  scriptedModel.length = 0;
  await reset();
});

const userAgent = () => env.USER_AGENT.getByName("user-1");

const reply = (text: string): AssistantMessage => ({
  role: "assistant",
  parts: [{ type: "text", text }],
});

const dailyAtEightUtc = { cron: "0 8 * * *", timeZone: "UTC" };

/** Puts a task straight into storage with its alarm, so a test can choose a next run time in the past. */
function insertTask(nextRunAt: Date, id = "task-1") {
  return runInDurableObject(userAgent(), async (_, state) => {
    store.insertTask(state.storage, {
      id,
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
    runNext(state.storage, testAgent, () => startedAt),
  );

  expect(wakeAt).toEqual(new Date(startedAt.getTime() + RETRY_DELAY_MS));
  const [failed] = await userAgent().recentRuns();
  expect(failed?.lastError).toBe("The model service is unreachable.");
  expect(failed?.endedAt).toBeNull();

  scriptedModel.push(reply("You have 3 new emails."));
  const retryAt = new Date(startedAt.getTime() + RETRY_DELAY_MS);
  await runInDurableObject(userAgent(), (_, state) =>
    runNext(state.storage, testAgent, () => retryAt),
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

test("a run that keeps failing is given up, keeping its error, and stops calling the model", async () => {
  const startedAt = new Date("2026-11-10T08:00:00Z");
  await insertTask(startedAt);
  for (let attempt = 1; attempt <= MAX_FAILED_ATTEMPTS; attempt += 1) {
    scriptedModel.push(new Error(`Attempt ${attempt} failed.`));
  }

  let wakeAt: Date | undefined;
  for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
    const now = new Date(startedAt.getTime() + attempt * RETRY_DELAY_MS);
    wakeAt = await runInDurableObject(userAgent(), (_, state) =>
      runNext(state.storage, testAgent, () => now),
    );
  }

  const [run] = await userAgent().recentRuns();
  expect(run?.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
  expect(run?.lastError).toBe(`Attempt ${MAX_FAILED_ATTEMPTS} failed.`);
  expect(run?.endedAt).not.toBeNull();
  expect(wakeAt).toEqual(new Date("2026-11-11T08:00:00Z"));
});

test("a task that missed several times runs once and moves to its next time after now", async () => {
  await insertTask(new Date("2026-11-07T08:00:00Z"));
  scriptedModel.push(reply("Done."));
  const now = new Date("2026-11-10T09:30:00Z");

  const wakeAt = await runInDurableObject(userAgent(), (_, state) =>
    runNext(state.storage, testAgent, () => now),
  );

  expect(await userAgent().recentRuns()).toHaveLength(1);
  expect(wakeAt).toEqual(new Date("2026-11-11T08:00:00Z"));
  const [task] = await userAgent().listTasks();
  expect(task?.nextRunAt).toEqual(new Date("2026-11-11T08:00:00Z"));
});

test("does one run per wake-up and wakes again right away while more is due", async () => {
  const dueAt = new Date("2026-11-10T08:00:00Z");
  await insertTask(dueAt, "task-1");
  await insertTask(dueAt, "task-2");
  scriptedModel.push(reply("First done."), reply("Second done."));

  const first = await runInDurableObject(userAgent(), (_, state) =>
    runNext(state.storage, testAgent, () => dueAt),
  );
  expect(await userAgent().recentRuns()).toHaveLength(1);
  expect(first).toEqual(dueAt);

  await runInDurableObject(userAgent(), (_, state) =>
    runNext(state.storage, testAgent, () => dueAt),
  );
  expect(new Set((await userAgent().recentRuns()).map((run) => run.taskId))).toEqual(
    new Set(["task-1", "task-2"]),
  );
});

test("a task removed while another task's run waits on the model doesn't start", async () => {
  const dueAt = new Date("2026-11-10T08:00:00Z");
  await insertTask(dueAt, "task-1");
  await insertTask(dueAt, "task-2");

  await runInDurableObject(userAgent(), async (_, state) => {
    scriptedModel.push(() => {
      store.deleteTask(state.storage, "task-2");
      return reply("Done.");
    });
    await runNext(state.storage, testAgent, () => dueAt);
    await runNext(state.storage, testAgent, () => dueAt);
  });

  expect((await userAgent().recentRuns()).map((run) => run.taskId)).toEqual(["task-1"]);
});

test("adding a task after a run failed doesn't put off the run's retry", async () => {
  const failedAt = new Date("2026-11-10T08:00:00Z");
  await insertTask(failedAt);
  scriptedModel.push(new Error("The model service is unreachable."));
  await runInDurableObject(userAgent(), (_, state) =>
    runNext(state.storage, testAgent, () => failedAt),
  );

  await userAgent().addTask({
    prompt: "New year's review",
    schedule: { cron: "0 0 1 1 *", timeZone: "UTC" },
  });

  expect(await runInDurableObject(userAgent(), (_, state) => state.storage.getAlarm())).toBe(
    failedAt.getTime() + RETRY_DELAY_MS,
  );
});

test("refuses storage that a newer version of the code migrated", async () => {
  await runInDurableObject(userAgent(), (_, state) => {
    state.storage.sql.exec(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('', ?)",
      Date.UTC(2100, 0, 1),
    );

    expect(() => store.migrate(state.storage)).toThrow(
      "Storage has a migration from 2100-01-01T00:00:00.000Z, newer than any this code knows.",
    );
  });
});

test("a failing migration throws the SQLite error and leaves nothing half applied", async () => {
  await runInDurableObject(userAgent(), (_, state) => {
    state.storage.sql.exec("DELETE FROM __drizzle_migrations");
    state.storage.sql.exec("DROP TABLE tasks");

    expect(() => store.migrate(state.storage)).toThrow(/already exists/);
    const tables = state.storage.sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE name = 'tasks'")
      .toArray();
    expect(tables).toEqual([]);
  });
});
