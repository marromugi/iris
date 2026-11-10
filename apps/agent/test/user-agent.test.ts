import type { AssistantMessage } from "@iris/agent";
import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import migrations from "../drizzle/migrations";
import { MAX_FAILED_ATTEMPTS, RETRY_DELAY_MS, runNext } from "../src/runner";
import * as store from "../src/store";
import { scriptedModel, testAgent } from "./worker";

afterEach(async () => {
  scriptedModel.length = 0;
  await reset();
});

const userAgent = () => env.USER_AGENT.getByName("user-1");

/** The agent every user starts with. */
async function firstAgentId(): Promise<string> {
  const [first] = await userAgent().listAgents();
  if (first === undefined) {
    throw new Error("The user has no agent.");
  }
  return first.id;
}

const reply = (text: string): AssistantMessage => ({
  role: "assistant",
  parts: [{ type: "text", text }],
});

const dailyAtEightUtc = { cron: "0 8 * * *", timeZone: "UTC" };

/**
 * Puts a task of the first agent straight into storage with its alarm, so a test can choose a next
 * run time in the past.
 */
function insertTask(nextRunAt: Date, id = "task-1") {
  return runInDurableObject(userAgent(), async (_, state) => {
    const [first] = store.listAgents(state.storage);
    store.insertTask(state.storage, {
      id,
      agentId: first?.id ?? "",
      prompt: "Summarize today's email",
      schedule: dailyAtEightUtc,
      nextRunAt,
    });
    await state.storage.setAlarm(nextRunAt);
  });
}

test("every user starts with one agent that hasn't run", async () => {
  expect(await userAgent().listAgents()).toEqual([
    {
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      name: "エージェント",
      lastRanAt: null,
    },
  ]);
});

test("adds an agent after the ones already there", async () => {
  const added = await userAgent().addAgent({ name: "  株価の確認 " });

  expect(added).toEqual({
    ok: true,
    agent: { id: expect.any(String), name: "株価の確認", lastRanAt: null },
  });
  expect((await userAgent().listAgents()).map((agent) => agent.name)).toEqual([
    "エージェント",
    "株価の確認",
  ]);
});

test("returns an empty name as an error and adds no agent", async () => {
  const added = await userAgent().addAgent({ name: "  " });

  expect(added.ok).toBe(false);
  expect(await userAgent().listAgents()).toHaveLength(1);
});

test("each agent has its own tasks and runs, and runs when its own task is due", async () => {
  const first = await firstAgentId();
  const added = await userAgent().addAgent({ name: "株価の確認" });
  if (!added.ok) {
    throw new Error(added.error);
  }
  const stocks = added.agent.id;
  const dueAt = new Date("2026-11-10T08:00:00Z");
  await runInDurableObject(userAgent(), (_, state) => {
    store.insertTask(state.storage, {
      id: "stocks-task",
      agentId: stocks,
      prompt: "Check stocks",
      schedule: dailyAtEightUtc,
      nextRunAt: dueAt,
    });
  });
  scriptedModel.push(reply("Stocks are up."));

  await runInDurableObject(userAgent(), (_, state) =>
    runNext(state.storage, testAgent, () => dueAt),
  );

  expect(await userAgent().listTasks(first)).toEqual([]);
  expect(await userAgent().recentRuns(first)).toEqual([]);
  expect((await userAgent().listTasks(stocks))?.map((task) => task.id)).toEqual(["stocks-task"]);
  const runs = await userAgent().recentRuns(stocks);
  expect(runs?.map((run) => run.taskId)).toEqual(["stocks-task"]);
  expect(await userAgent().listAgents()).toEqual([
    { id: first, name: "エージェント", lastRanAt: null },
    { id: stocks, name: "株価の確認", lastRanAt: dueAt },
  ]);
});

test("answers undefined for an agent the user doesn't have, and changes nothing", async () => {
  const missing = crypto.randomUUID();
  const agent = userAgent();

  expect(await agent.listTasks(missing)).toBeUndefined();
  expect(await agent.recentRuns(missing)).toBeUndefined();
  expect(
    await agent.addTask(missing, { prompt: "Check stocks", schedule: dailyAtEightUtc }),
  ).toBeUndefined();
  expect(await agent.removeTask(missing, crypto.randomUUID())).toBeUndefined();
  expect(await agent.listTasks(await firstAgentId())).toEqual([]);
  expect(await runInDurableObject(agent, (_, state) => state.storage.getAlarm())).toBeNull();
});

test("doesn't remove another agent's task", async () => {
  const first = await firstAgentId();
  const added = await userAgent().addAgent({ name: "株価の確認" });
  if (!added.ok) {
    throw new Error(added.error);
  }
  const task = await userAgent().addTask(first, {
    prompt: "Check mail",
    schedule: dailyAtEightUtc,
  });
  if (!task?.ok) {
    throw new Error("The task wasn't added.");
  }

  expect(await userAgent().removeTask(added.agent.id, task.task.id)).toBe(false);

  expect(await userAgent().listTasks(first)).toHaveLength(1);
});

test("adds a task and sets the alarm to its next run time", async () => {
  const agent = userAgent();
  const agentId = await firstAgentId();

  const added = await agent.addTask(agentId, {
    prompt: "Summarize today's email",
    schedule: { cron: "0 8 * * *", timeZone: "Asia/Tokyo" },
  });

  expect(added?.ok).toBe(true);
  const tasks = (await agent.listTasks(agentId)) ?? [];
  expect(tasks.map((task) => [task.prompt, task.schedule])).toEqual([
    ["Summarize today's email", { cron: "0 8 * * *", timeZone: "Asia/Tokyo" }],
  ]);
  const alarm = await runInDurableObject(agent, (_, state) => state.storage.getAlarm());
  expect(alarm).toBe(tasks[0]?.nextRunAt.getTime());
});

test("returns an invalid schedule as an error and adds nothing", async () => {
  const agent = userAgent();
  const agentId = await firstAgentId();

  const added = await agent.addTask(agentId, {
    prompt: "Summarize today's email",
    schedule: { cron: "0 8 * * *", timeZone: "Mars/Olympus" },
  });

  expect(added).toEqual({
    ok: false,
    error: "✖ Not a known IANA time zone.\n  → at schedule.timeZone",
  });
  expect(await agent.listTasks(agentId)).toEqual([]);
});

test("removing the last task clears the alarm", async () => {
  const agent = userAgent();
  const agentId = await firstAgentId();
  const added = await agent.addTask(agentId, { prompt: "Check stocks", schedule: dailyAtEightUtc });
  if (!added?.ok) {
    throw new Error("The task wasn't added.");
  }

  expect(await agent.removeTask(agentId, added.task.id)).toBe(true);

  expect(await agent.listTasks(agentId)).toEqual([]);
  expect(await runInDurableObject(agent, (_, state) => state.storage.getAlarm())).toBeNull();
});

test("when the alarm fires, runs the due task and saves its conversation", async () => {
  await insertTask(new Date(Date.now() - 60_000));
  scriptedModel.push(reply("You have 3 new emails."));

  expect(await runDurableObjectAlarm(userAgent())).toBe(true);

  const agentId = await firstAgentId();
  const runs = (await userAgent().recentRuns(agentId)) ?? [];
  expect(runs).toHaveLength(1);
  expect(runs[0]?.messages).toEqual([
    { role: "user", text: "Summarize today's email" },
    reply("You have 3 new emails."),
  ]);
  expect(runs[0]?.endedAt).not.toBeNull();
  const [task] = (await userAgent().listTasks(agentId)) ?? [];
  expect(task?.nextRunAt.getTime()).toBeGreaterThan(Date.now());
});

test("a failed run is tried again later and carried on, not started again", async () => {
  const startedAt = new Date("2026-11-10T08:00:00Z");
  await insertTask(startedAt);
  scriptedModel.push(new Error("The model service is unreachable."));
  const agentId = await firstAgentId();

  const wakeAt = await runInDurableObject(userAgent(), (_, state) =>
    runNext(state.storage, testAgent, () => startedAt),
  );

  expect(wakeAt).toEqual(new Date(startedAt.getTime() + RETRY_DELAY_MS));
  const [failed] = (await userAgent().recentRuns(agentId)) ?? [];
  expect(failed?.lastError).toBe("The model service is unreachable.");
  expect(failed?.endedAt).toBeNull();

  scriptedModel.push(reply("You have 3 new emails."));
  const retryAt = new Date(startedAt.getTime() + RETRY_DELAY_MS);
  await runInDurableObject(userAgent(), (_, state) =>
    runNext(state.storage, testAgent, () => retryAt),
  );

  const runs = (await userAgent().recentRuns(agentId)) ?? [];
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

  const [run] = (await userAgent().recentRuns(await firstAgentId())) ?? [];
  expect(run?.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
  expect(run?.lastError).toBe(`Attempt ${MAX_FAILED_ATTEMPTS} failed.`);
  expect(run?.endedAt).not.toBeNull();
  expect(wakeAt).toEqual(new Date("2026-11-11T08:00:00Z"));
});

test("a task that missed several times runs once and moves to its next time after now", async () => {
  await insertTask(new Date("2026-11-07T08:00:00Z"));
  scriptedModel.push(reply("Done."));
  const now = new Date("2026-11-10T09:30:00Z");
  const agentId = await firstAgentId();

  const wakeAt = await runInDurableObject(userAgent(), (_, state) =>
    runNext(state.storage, testAgent, () => now),
  );

  expect(await userAgent().recentRuns(agentId)).toHaveLength(1);
  expect(wakeAt).toEqual(new Date("2026-11-11T08:00:00Z"));
  const [task] = (await userAgent().listTasks(agentId)) ?? [];
  expect(task?.nextRunAt).toEqual(new Date("2026-11-11T08:00:00Z"));
});

test("does one run per wake-up and wakes again right away while more is due", async () => {
  const dueAt = new Date("2026-11-10T08:00:00Z");
  await insertTask(dueAt, "task-1");
  await insertTask(dueAt, "task-2");
  scriptedModel.push(reply("First done."), reply("Second done."));
  const agentId = await firstAgentId();

  const first = await runInDurableObject(userAgent(), (_, state) =>
    runNext(state.storage, testAgent, () => dueAt),
  );
  expect(await userAgent().recentRuns(agentId)).toHaveLength(1);
  expect(first).toEqual(dueAt);

  await runInDurableObject(userAgent(), (_, state) =>
    runNext(state.storage, testAgent, () => dueAt),
  );
  const runs = (await userAgent().recentRuns(agentId)) ?? [];
  expect(new Set(runs.map((run) => run.taskId))).toEqual(new Set(["task-1", "task-2"]));
});

test("a task removed while another task's run waits on the model doesn't start", async () => {
  const dueAt = new Date("2026-11-10T08:00:00Z");
  await insertTask(dueAt, "task-1");
  await insertTask(dueAt, "task-2");
  const agentId = await firstAgentId();

  await runInDurableObject(userAgent(), async (_, state) => {
    scriptedModel.push(() => {
      store.deleteTask(state.storage, agentId, "task-2");
      return reply("Done.");
    });
    await runNext(state.storage, testAgent, () => dueAt);
    await runNext(state.storage, testAgent, () => dueAt);
  });

  const runs = (await userAgent().recentRuns(agentId)) ?? [];
  expect(runs.map((run) => run.taskId)).toEqual(["task-1"]);
});

test("adding a task after a run failed doesn't put off the run's retry", async () => {
  const failedAt = new Date("2026-11-10T08:00:00Z");
  await insertTask(failedAt);
  scriptedModel.push(new Error("The model service is unreachable."));
  await runInDurableObject(userAgent(), (_, state) =>
    runNext(state.storage, testAgent, () => failedAt),
  );

  await userAgent().addTask(await firstAgentId(), {
    prompt: "New year's review",
    schedule: { cron: "0 0 1 1 *", timeZone: "UTC" },
  });

  expect(await runInDurableObject(userAgent(), (_, state) => state.storage.getAlarm())).toBe(
    failedAt.getTime() + RETRY_DELAY_MS,
  );
});

test("the tasks and runs stored before agents become the first agent's", async () => {
  const startedAt = new Date("2026-11-09T08:00:00Z");
  await runInDurableObject(userAgent(), (_, state) => {
    const sql = state.storage.sql;
    for (const table of ["messages", "runs", "tasks", "agents", "__drizzle_migrations"]) {
      sql.exec(`DROP TABLE ${table}`);
    }
    // Storage as the code before agents left it: the first migration, and a task with one run.
    sql.exec(
      "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
    );
    for (const statement of migrations.migrations.m0000.split("--> statement-breakpoint")) {
      sql.exec(statement);
    }
    sql.exec(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('', ?)",
      migrations.journal.entries[0]?.when,
    );
    sql.exec(
      "INSERT INTO tasks (id, prompt, cron, time_zone, next_run_at) VALUES ('task-1', 'Check mail', '0 8 * * *', 'UTC', ?)",
      Date.parse("2026-11-10T08:00:00Z"),
    );
    sql.exec(
      "INSERT INTO runs (id, task_id, started_at, ended_at) VALUES ('run-1', 'task-1', ?, ?)",
      startedAt.getTime(),
      startedAt.getTime() + 1000,
    );
    sql.exec(
      "INSERT INTO messages (run_id, seq, format, body) VALUES ('run-1', 0, 1, ?)",
      JSON.stringify({ role: "user", text: "Check mail" }),
    );

    store.migrate(state.storage);
  });

  const [agent, ...others] = await userAgent().listAgents();
  expect(others).toEqual([]);
  expect(agent).toEqual({ id: expect.any(String), name: "エージェント", lastRanAt: startedAt });
  expect((await userAgent().listTasks(agent!.id))?.map((task) => task.id)).toEqual(["task-1"]);
  const runs = (await userAgent().recentRuns(agent!.id)) ?? [];
  expect(runs.map((run) => [run.id, run.messages])).toEqual([
    ["run-1", [{ role: "user", text: "Check mail" }]],
  ]);
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
