import { type AssistantMessage, DEFAULT_MAX_STEPS } from "@iris/agent";
import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import migrations from "../drizzle/migrations";
import { MAX_FAILED_ATTEMPTS, RETRY_DELAY_MS, runDue } from "../src/runner";
import { RunBroadcast } from "../src/run-broadcast";
import * as store from "../src/store";
import { listen } from "./run-events";
import { modelRequests, scriptedModel, testAgent } from "./worker";
import { agentThread } from "./agent-thread";

/** Any look; agents get one at random unless they are given one. */
const anyLook = { palette: expect.any(Number), seed: expect.any(Number) };

afterEach(async () => {
  scriptedModel.length = 0;
  modelRequests.length = 0;
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
async function insertTask(nextRunAt: Date, id = "task-1") {
  const agentId = await firstAgentId();
  await runInDurableObject(userAgent(), async (_, state) => {
    store.insertTask(state.storage, {
      id,
      agentId,
      threadId: agentThread(state.storage, agentId),
      prompt: "Summarize today's email",
      schedule: dailyAtEightUtc,
      nextRunAt,
    });
    await state.storage.setAlarm(nextRunAt);
  });
}

/** Puts a second agent straight into storage, added after the first; returns its ID. */
async function insertAgent(name: string): Promise<string> {
  const id = crypto.randomUUID();
  await runInDurableObject(userAgent(), (_, state) => {
    store.insertAgent(state.storage, {
      id,
      name,
      look: { palette: 0, seed: 0 },
      createdAt: new Date(Date.now() + 1000),
    });
  });
  return id;
}

/** Starts a run of the agent straight in storage, at a time the test chooses. */
async function startRun(id: string, agentId: string, text: string, startedAt: Date) {
  await runInDurableObject(userAgent(), (_, state) => {
    store.startRun(state.storage, {
      id,
      agentId,
      threadId: agentThread(state.storage, agentId),
      text,
      startedAt,
    });
  });
}

/** Does the next piece of due work as if it were `now`. */
function runNextAt(now: Date) {
  return runInDurableObject(userAgent(), (_, state) => runDue(state.storage, testAgent, () => now));
}

test("every user starts with one agent that hasn't run", async () => {
  expect(await userAgent().listAgents()).toEqual([
    {
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      name: "エージェント",
      look: anyLook,
      lastRanAt: null,
    },
  ]);
});

test("an added agent comes last in the list with its own thread, and a blank or long name is refused", async () => {
  const added = await userAgent().addAgent({ name: "  株価の確認  " });
  const blank = await userAgent().addAgent({ name: "   " });
  const chosen = await userAgent().addAgent({ name: "ニュース", look: { palette: 3, seed: 42 } });
  const badLook = await userAgent().addAgent({ name: "ニュース", look: { palette: -1, seed: 42 } });
  const long = await userAgent().addAgent({ name: "あ".repeat(41) });

  if (!added.ok) {
    throw new Error(added.error);
  }
  expect(added.agent).toEqual({
    id: expect.any(String),
    name: "株価の確認",
    look: anyLook,
    lastRanAt: null,
  });
  expect((await userAgent().listAgents()).map((agent) => agent.name)).toEqual([
    "エージェント",
    "株価の確認",
    "ニュース",
  ]);
  const threads = await runInDurableObject(userAgent(), (_, state) => [
    store.agentThreadId(state.storage, added.agent.id),
    store.agentThreadId(state.storage, "no-such-agent"),
  ]);
  expect(threads).toEqual([expect.any(String), undefined]);
  expect(blank.ok).toBe(false);
  expect(long.ok).toBe(false);
  expect(chosen.ok && chosen.agent.look).toEqual({ palette: 3, seed: 42 });
  expect(badLook.ok).toBe(false);
});

test("each agent has its own tasks and runs, and runs when its own task is due", async () => {
  const first = await firstAgentId();
  const stocks = await insertAgent("株価の確認");
  const dueAt = new Date("2026-11-10T08:00:00Z");
  await runInDurableObject(userAgent(), (_, state) => {
    store.insertTask(state.storage, {
      id: "stocks-task",
      agentId: stocks,
      threadId: agentThread(state.storage, stocks),
      prompt: "Check stocks",
      schedule: dailyAtEightUtc,
      nextRunAt: dueAt,
    });
  });
  scriptedModel.push(reply("Stocks are up."));

  await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => dueAt),
  );

  expect(await userAgent().listTasks(first)).toEqual([]);
  expect(await userAgent().recentRuns(first)).toEqual([]);
  expect((await userAgent().listTasks(stocks))?.map((task) => task.id)).toEqual(["stocks-task"]);
  const runs = await userAgent().recentRuns(stocks);
  expect(runs?.map((run) => run.taskId)).toEqual(["stocks-task"]);
  expect(await userAgent().listAgents()).toEqual([
    { id: first, name: "エージェント", look: anyLook, lastRanAt: null },
    { id: stocks, name: "株価の確認", look: anyLook, lastRanAt: dueAt },
  ]);
});

test("adds no task, and sets no alarm, for an agent the user doesn't have", async () => {
  const agent = userAgent();

  await agent.addTask(crypto.randomUUID(), { prompt: "Check stocks", schedule: dailyAtEightUtc });

  expect(await agent.listTasks(await firstAgentId())).toEqual([]);
  expect(await runInDurableObject(agent, (_, state) => state.storage.getAlarm())).toBeNull();
});

test("doesn't remove another agent's task", async () => {
  const first = await firstAgentId();
  const stocks = await insertAgent("株価の確認");
  const task = await userAgent().addTask(first, {
    prompt: "Check mail",
    schedule: dailyAtEightUtc,
  });
  if (!task?.ok) {
    throw new Error("The task wasn't added.");
  }

  expect(await userAgent().removeTask(stocks, task.task.id)).toBe(false);

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
    runDue(state.storage, testAgent, () => startedAt),
  );

  expect(wakeAt).toEqual(new Date(startedAt.getTime() + RETRY_DELAY_MS));
  const [failed] = (await userAgent().recentRuns(agentId)) ?? [];
  expect(failed?.lastError).toBe("The model service is unreachable.");
  expect(failed?.endedAt).toBeNull();

  scriptedModel.push(reply("You have 3 new emails."));
  const retryAt = new Date(startedAt.getTime() + RETRY_DELAY_MS);
  await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => retryAt),
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

test("a run carried on in a later wake-up gives the model back the reasoning it stored", async () => {
  const startedAt = new Date("2026-11-10T08:00:00Z");
  await insertTask(startedAt);
  const lookUp: AssistantMessage = {
    role: "assistant",
    parts: [
      { type: "reasoning", data: { type: "thinking", thinking: "", signature: "s1" } },
      { type: "tool-call", id: "c1", name: "mail", input: {} },
    ],
  };
  scriptedModel.push(lookUp, new Error("The model service is unreachable."));
  await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => startedAt),
  );

  scriptedModel.push(reply("You have 3 new emails."));
  const retryAt = new Date(startedAt.getTime() + RETRY_DELAY_MS);
  await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => retryAt),
  );

  expect(modelRequests.at(-1)?.messages).toEqual([
    { role: "user", text: "Summarize today's email" },
    lookUp,
    { role: "tool", callId: "c1", isError: true, content: 'There is no tool named "mail".' },
  ]);
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
      runDue(state.storage, testAgent, () => now),
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
    runDue(state.storage, testAgent, () => now),
  );

  expect(await userAgent().recentRuns(agentId)).toHaveLength(1);
  expect(wakeAt).toEqual(new Date("2026-11-11T08:00:00Z"));
  const [task] = (await userAgent().listTasks(agentId)) ?? [];
  expect(task?.nextRunAt).toEqual(new Date("2026-11-11T08:00:00Z"));
});

test("one wake-up carries on every due run side by side, and wakes for nothing more", async () => {
  const dueAt = new Date("2026-11-10T08:00:00Z");
  const other = await insertAgent("株価の確認");
  await insertTask(dueAt, "task-1");
  await runInDurableObject(userAgent(), (_, state) => {
    store.insertTask(state.storage, {
      id: "task-2",
      agentId: other,
      threadId: agentThread(state.storage, other),
      prompt: "Check stocks",
      schedule: dailyAtEightUtc,
      nextRunAt: dueAt,
    });
  });
  const { promise: bothAsked, resolve: release } = Promise.withResolvers<void>();
  // Each reply waits until both runs have asked the model, so they only end if they go side by side.
  const waitForBoth = async () => {
    if (modelRequests.length === 2) {
      release();
    }
    await bothAsked;
    return reply("Done.");
  };
  scriptedModel.push(waitForBoth, waitForBoth);

  const next = await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => dueAt),
  );

  expect(modelRequests).toHaveLength(2);
  expect(next).toEqual(new Date("2026-11-11T08:00:00Z"));
  const ended = await runInDurableObject(userAgent(), (_, state) =>
    state.storage.sql.exec("SELECT count(*) AS ended FROM runs WHERE ended_at IS NOT NULL").one(),
  );
  expect(ended).toEqual({ ended: 2 });
});

test("a run still going when the wake-up runs out of time stops after its message and is due at once", async () => {
  const dueAt = new Date("2026-11-10T08:00:00Z");
  await insertTask(dueAt, "task-1");
  let clock = dueAt.getTime();
  const toolCall: AssistantMessage = {
    role: "assistant",
    parts: [{ type: "tool-call", id: "call-1", name: "missing", input: {} }],
  };
  scriptedModel.push(() => {
    clock += RETRY_DELAY_MS * 3;
    return toolCall;
  });

  const next = await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => new Date(clock)),
  );

  const [run] = (await userAgent().recentRuns(await firstAgentId())) ?? [];
  expect(run?.endedAt).toBeNull();
  expect(run?.messages.at(-1)).toEqual(toolCall);
  expect(next).toEqual(new Date(clock));
});

test("adding a task after a run failed doesn't put off the run's retry", async () => {
  // Noon tomorrow: the alarm this test reads must be a time to come.
  const today = new Date();
  const failedAt = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, 12),
  );
  await insertTask(failedAt);
  scriptedModel.push(new Error("The model service is unreachable."));
  await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => failedAt),
  );

  await userAgent().addTask(await firstAgentId(), {
    prompt: "New year's review",
    schedule: { cron: "0 0 1 1 *", timeZone: "UTC" },
  });

  expect(await runInDurableObject(userAgent(), (_, state) => state.storage.getAlarm())).toBe(
    failedAt.getTime() + RETRY_DELAY_MS,
  );
});

test("a socket that opens while runs go on hears each one's latest progress", async () => {
  const agentId = await firstAgentId();
  await startRun("run-a", agentId, "Hi", new Date());
  await startRun("run-b", agentId, "Hi", new Date());

  const heard = await runInDurableObject(userAgent(), async (_, state) => {
    const broadcast = new RunBroadcast(state);
    broadcast.progress("run-a", { type: "thinking" });
    broadcast.progress("run-b", { type: "starting" });
    const { 0: client, 1: server } = new WebSocketPair();
    broadcast.accept(agentThread(state.storage, agentId), server, "runs");
    return listen(client).heard(2);
  });

  expect(heard).toEqual([
    { type: "progress", runId: "run-a", progress: { type: "thinking" } },
    { type: "progress", runId: "run-b", progress: { type: "starting" } },
  ]);
});

test("a run that took its steps across wake-ups ends where it is", async () => {
  const dueAt = new Date("2026-11-10T08:00:00Z");
  const agentId = await firstAgentId();
  await startRun("long", agentId, "Keep going", dueAt);
  await runInDurableObject(userAgent(), (_, state) => {
    for (let seq = 1; seq <= DEFAULT_MAX_STEPS; seq += 1) {
      store.appendMessage(state.storage, "long", seq, {
        role: "assistant",
        parts: [{ type: "text", text: `Step ${seq}.` }],
      });
    }
    // Saved as if the steps' last message weren't a reply, so only the step count can end it.
    state.storage.sql.exec(
      "UPDATE messages SET body = ? WHERE run_id = 'long' AND seq = ?",
      JSON.stringify({ role: "user", text: "Go on." }),
      DEFAULT_MAX_STEPS,
    );
  });

  await runNextAt(dueAt);

  const [run] = (await userAgent().recentRuns(agentId)) ?? [];
  expect(modelRequests).toHaveLength(0);
  expect(run?.endedAt).not.toBeNull();
});

test("a socket that opens while a run is being written hears the text so far at once", async () => {
  const agentId = await firstAgentId();
  const runId = crypto.randomUUID();
  await startRun(runId, agentId, "Hi", new Date());

  const first = await runInDurableObject(userAgent(), async (_, state) => {
    const broadcast = new RunBroadcast(state);
    broadcast.progress(runId, { type: "writing", text: "Hel" });
    const { 0: client, 1: server } = new WebSocketPair();
    broadcast.accept(agentThread(state.storage, agentId), server, "runs");
    const [event] = await listen(client).heard(1);
    return event;
  });

  expect(first).toEqual({ type: "progress", runId, progress: { type: "writing", text: "Hel" } });
});

test("writing that comes too soon goes out once the interval is over, as the latest", async () => {
  const agentId = await firstAgentId();
  const runId = crypto.randomUUID();
  await startRun(runId, agentId, "Hi", new Date());

  const heard = await runInDurableObject(userAgent(), async (_, state) => {
    const broadcast = new RunBroadcast(state);
    const { 0: client, 1: server } = new WebSocketPair();
    broadcast.accept(agentThread(state.storage, agentId), server, "runs");
    const socket = listen(client);
    broadcast.progress(runId, { type: "writing", text: "Hel" });
    broadcast.progress(runId, { type: "writing", text: "Hello" });
    broadcast.progress(runId, { type: "writing", text: "Hello, wor" });
    return socket.heard(2);
  });

  expect(heard.map((event) => event.type === "progress" && event.progress)).toEqual([
    { type: "writing", text: "Hel" },
    { type: "writing", text: "Hello, wor" },
  ]);
});

test("a watcher that throws changes nothing about the run", async () => {
  const dueAt = new Date("2026-11-10T08:00:00Z");
  await insertTask(dueAt);
  scriptedModel.push((request) => {
    request.onProgress?.({ type: "writing", text: "You have" });
    return reply("You have 3 new emails.");
  });
  const throwing = {
    changed() {
      throw new Error("The socket went away.");
    },
    progress() {
      throw new Error("The socket went away.");
    },
    stopped() {
      throw new Error("The socket went away.");
    },
    posted() {
      throw new Error("The socket went away.");
    },
  };

  await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => dueAt, throwing),
  );

  const [run] = (await userAgent().recentRuns(await firstAgentId())) ?? [];
  expect(run?.endedAt).not.toBeNull();
  expect(run?.lastError).toBeNull();
  expect(run?.failedAttempts).toBe(0);
});

test("a message starts a run due at once, which the model answers after the agent's earlier runs", async () => {
  const earlier = new Date(Date.now() - 60_000);
  await insertTask(earlier);
  scriptedModel.push(reply("You have 3 new emails."));
  await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => earlier),
  );
  const agentId = await firstAgentId();

  const sent = await userAgent().sendMessage(agentId, { text: " Which one is urgent? " });

  expect(sent).toEqual({
    ok: true,
    run: {
      id: expect.any(String),
      agentId,
      threadId: expect.any(String),
      taskId: null,
      postId: expect.any(String),
      startedAt: expect.any(Date),
      endedAt: null,
      lastError: null,
      failedAttempts: 0,
      messages: [{ role: "user", text: "Which one is urgent?" }],
      consults: [],
    },
  });
  const alarm = await runInDurableObject(userAgent(), (_, state) => state.storage.getAlarm());
  expect(alarm).toBeLessThanOrEqual(Date.now());

  scriptedModel.push(reply("The one from your bank."));
  expect(await runDurableObjectAlarm(userAgent())).toBe(true);

  expect(modelRequests.at(-1)?.messages).toEqual([
    { role: "user", text: "Summarize today's email" },
    reply("You have 3 new emails."),
    { role: "user", text: "Which one is urgent?" },
  ]);
  const [answered] = (await userAgent().recentRuns(agentId)) ?? [];
  expect(answered?.messages).toEqual([
    { role: "user", text: "Which one is urgent?" },
    reply("The one from your bank."),
  ]);
  expect(answered?.endedAt).not.toBeNull();
});

test("sends no message, and sets no alarm, to an agent the user doesn't have or with no text", async () => {
  const agentId = await firstAgentId();

  expect(await userAgent().sendMessage(crypto.randomUUID(), { text: "Hello" })).toBeUndefined();
  expect(await userAgent().sendMessage(agentId, { text: "  " })).toEqual({
    ok: false,
    error: expect.any(String),
  });

  expect(await userAgent().recentRuns(agentId)).toEqual([]);
  expect(await runInDurableObject(userAgent(), (_, state) => state.storage.getAlarm())).toBeNull();
});

test("while a run waits on the model, it is due again only after the retry delay", async () => {
  const sentAt = new Date("2026-11-10T07:00:00Z");
  await startRun("sent", await firstAgentId(), "Hello", sentAt);

  const dueDuringCall = await runInDurableObject(userAgent(), async (_, state) => {
    let due: Date | undefined;
    scriptedModel.push(() => {
      due = store.earliestRunDueAt(state.storage);
      return reply("Hi.");
    });
    await runDue(state.storage, testAgent, () => sentAt);
    return due;
  });

  // An attempt cut off during the call is tried again then, not at once.
  expect(dueDuringCall).toEqual(new Date(sentAt.getTime() + RETRY_DELAY_MS));
});

test("a thread's runs go one at a time in the order they started, each reading the ones before it", async () => {
  const otherId = await insertAgent("Second");
  const sentAt = new Date("2026-11-10T07:00:00Z");
  const retryAt = new Date(sentAt.getTime() + RETRY_DELAY_MS);

  await startRun("other", otherId, "For the other agent", new Date("2026-11-10T06:00:00Z"));
  scriptedModel.push(reply("Other answer."));
  await runNextAt(new Date("2026-11-10T06:00:00Z"));
  await startRun("sent", await firstAgentId(), "First question", sentAt);
  scriptedModel.push(new Error("The model service is unreachable."));
  await runNextAt(sentAt);
  // The task's run starts while the sent message's run waits to be tried again.
  await insertTask(new Date("2026-11-10T07:01:00Z"));
  const wakeAt = await runNextAt(new Date("2026-11-10T07:01:00Z"));
  scriptedModel.push(reply("First answer."), reply("You have 3 new emails."));
  await runNextAt(retryAt);
  await runNextAt(retryAt);

  expect(wakeAt).toEqual(retryAt);
  expect(modelRequests.slice(1).map((request) => request.messages)).toEqual([
    [{ role: "user", text: "First question" }],
    [{ role: "user", text: "First question" }],
    [
      { role: "user", text: "First question" },
      reply("First answer."),
      { role: "user", text: "Summarize today's email" },
    ],
  ]);
});

/** Empties the storage and applies the first `count` migrations, as an older version of the code left it. */
function storageMigratedUpTo(storage: DurableObjectStorage, count: number) {
  const sql = storage.sql;
  for (const table of [
    "mails",
    "messages",
    "runs",
    "tasks",
    "posts",
    "search_counts",
    "thread_members",
    "threads",
    "agents",
    "__drizzle_migrations",
  ]) {
    sql.exec(`DROP TABLE ${table}`);
  }
  sql.exec(
    "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
  );
  const sqlByKey: Record<string, string> = migrations.migrations;
  for (const entry of migrations.journal.entries.slice(0, count)) {
    const text = sqlByKey[`m${entry.idx.toString().padStart(4, "0")}`];
    if (text === undefined) {
      throw new Error(`Migration ${entry.tag} has no SQL.`);
    }
    for (const statement of text.split("--> statement-breakpoint")) {
      sql.exec(statement);
    }
    sql.exec("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('', ?)", entry.when);
  }
}

test("the tasks and runs stored before agents become the first agent's", async () => {
  const startedAt = new Date("2026-11-09T08:00:00Z");
  await runInDurableObject(userAgent(), (_, state) => {
    const sql = state.storage.sql;
    // Storage as the code before agents left it: a task with one run.
    storageMigratedUpTo(state.storage, 1);
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
  expect(agent).toEqual({
    id: expect.any(String),
    name: "エージェント",
    look: anyLook,
    lastRanAt: startedAt,
  });
  expect((await userAgent().listTasks(agent!.id))?.map((task) => task.id)).toEqual(["task-1"]);
  const runs = (await userAgent().recentRuns(agent!.id)) ?? [];
  expect(runs.map((run) => [run.id, run.messages])).toEqual([
    ["run-1", [{ role: "user", text: "Check mail" }]],
  ]);
});

test("a run that hasn't ended stays due when it was before runs kept a due time", async () => {
  const startedAt = Date.parse("2026-11-10T08:00:00Z");
  const failedAt = Date.parse("2026-11-10T08:10:00Z");
  const due = await runInDurableObject(userAgent(), (_, state) => {
    const sql = state.storage.sql;
    // Storage as the code before due times left it: one run cut off, one that failed, one ended.
    storageMigratedUpTo(state.storage, 2);
    const agentId = sql.exec<{ id: string }>("SELECT id FROM agents").one().id;
    const insert =
      "INSERT INTO runs (id, agent_id, task_id, started_at, ended_at, last_error, failed_attempts, last_failed_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)";
    sql.exec(insert, "cut-off", agentId, startedAt, null, null, 0, null);
    sql.exec(insert, "failed", agentId, startedAt - 60_000, null, "Unreachable.", 1, failedAt);
    sql.exec(insert, "ended", agentId, startedAt, startedAt + 1000, null, 0, null);

    store.migrate(state.storage);

    return sql
      .exec<{ id: string; due_at: number }>(
        "SELECT id, due_at FROM runs WHERE ended_at IS NULL ORDER BY id",
      )
      .toArray();
  });

  expect(due).toEqual([
    { id: "cut-off", due_at: startedAt + RETRY_DELAY_MS },
    { id: "failed", due_at: failedAt + RETRY_DELAY_MS },
  ]);
});

test("each agent stored before threads gets its own, where its tasks and runs then happen", async () => {
  const startedAt = Date.parse("2026-11-10T08:00:00Z");
  const moved = await runInDurableObject(userAgent(), (_, state) => {
    const sql = state.storage.sql;
    // Storage as the code before threads left it: two agents, each with a task and a run.
    storageMigratedUpTo(state.storage, 3);
    sql.exec(
      "INSERT INTO agents (id, name, created_at) VALUES ('agent-2', 'Second', ?)",
      startedAt,
    );
    for (const agentId of sql
      .exec<{ id: string }>("SELECT id FROM agents")
      .toArray()
      .map((row) => row.id)) {
      sql.exec(
        "INSERT INTO tasks (id, agent_id, prompt, cron, time_zone, next_run_at) VALUES (?, ?, 'Check mail', '0 8 * * *', 'UTC', ?)",
        `task-of-${agentId}`,
        agentId,
        startedAt,
      );
      sql.exec(
        "INSERT INTO runs (id, agent_id, task_id, started_at, due_at) VALUES (?, ?, NULL, ?, ?)",
        `run-of-${agentId}`,
        agentId,
        startedAt,
        startedAt,
      );
    }

    store.migrate(state.storage);

    const threadOf = (agentId: string) => store.agentThreadId(state.storage, agentId);
    return sql
      .exec<{ id: string }>("SELECT id FROM agents")
      .toArray()
      .map(({ id }) => ({
        thread: threadOf(id),
        tasks: sql
          .exec<{ thread_id: string }>("SELECT thread_id FROM tasks WHERE agent_id = ?", id)
          .toArray()
          .map((row) => row.thread_id),
        runs: sql
          .exec<{ thread_id: string }>("SELECT thread_id FROM runs WHERE agent_id = ?", id)
          .toArray()
          .map((row) => row.thread_id),
      }));
  });

  expect(moved).toHaveLength(2);
  for (const { thread, tasks, runs } of moved) {
    expect(thread).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(tasks).toEqual([thread]);
    expect(runs).toEqual([thread]);
  }
  expect(moved[0]?.thread).not.toBe(moved[1]?.thread);
});

test("a run a message started before posts becomes a post it replies to; a task's run doesn't", async () => {
  const startedAt = Date.parse("2026-11-10T08:00:00Z");
  const moved = await runInDurableObject(userAgent(), (_, state) => {
    const sql = state.storage.sql;
    // Storage as the code before posts left it: one run a message started, one a task did.
    storageMigratedUpTo(state.storage, 4);
    const agentId = sql.exec<{ id: string }>("SELECT id FROM agents").one().id;
    const threadId = sql.exec<{ id: string }>("SELECT id FROM threads").one().id;
    const insert =
      "INSERT INTO runs (id, agent_id, thread_id, task_id, started_at, due_at) VALUES (?, ?, ?, ?, ?, ?)";
    sql.exec(insert, "sent", agentId, threadId, null, startedAt, startedAt);
    sql.exec(insert, "scheduled", agentId, threadId, "task-1", startedAt, startedAt);
    for (const [runId, text] of [
      ["sent", "Hi"],
      ["scheduled", "Check mail"],
    ]) {
      sql.exec(
        "INSERT INTO messages (run_id, seq, format, body) VALUES (?, 0, 1, ?)",
        runId,
        JSON.stringify({ role: "user", text }),
      );
    }

    store.migrate(state.storage);

    return {
      posts: sql.exec("SELECT id, thread_id, text, created_at FROM posts").toArray(),
      runs: sql.exec("SELECT id, post_id FROM runs ORDER BY id").toArray(),
      members: sql.exec("SELECT thread_id, agent_id FROM thread_members").toArray(),
      threadId,
      agentId,
    };
  });

  expect(moved.posts).toEqual([
    { id: "sent", thread_id: moved.threadId, text: "Hi", created_at: startedAt },
  ]);
  expect(moved.runs).toEqual([
    { id: "scheduled", post_id: null },
    { id: "sent", post_id: "sent" },
  ]);
  expect(moved.members).toEqual([{ thread_id: moved.threadId, agent_id: moved.agentId }]);
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
