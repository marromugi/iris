import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import * as store from "../src/store";

afterEach(async () => {
  await reset();
});

const userAgent = () => env.USER_AGENT.getByName("user-1");

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));

/** Adds an agent and returns its ID with its thread's. */
async function agentWithThread(name: string) {
  const added = await userAgent().addAgent({ name });
  if (!added.ok) {
    throw new Error(added.error);
  }
  const threadId = await runInDurableObject(userAgent(), (_, state) =>
    store.agentThreadId(state.storage, added.agent.id),
  );
  return { agentId: added.agent.id, threadId: threadId ?? "" };
}

test("nextDueRuns lists the runs due by now, the earliest due first, and no more than the limit asks", async () => {
  const late = await agentWithThread("遅い");
  const early = await agentWithThread("早い");

  const ids = await runInDurableObject(userAgent(), (_, state) => {
    store.startRun(state.storage, {
      id: "late-run",
      agentId: late.agentId,
      threadId: late.threadId,
      text: "later",
      startedAt: at(0),
    });
    store.postponeRun(state.storage, "late-run", at(2));
    store.startRun(state.storage, {
      id: "early-run",
      agentId: early.agentId,
      threadId: early.threadId,
      text: "earlier",
      startedAt: at(1),
    });
    store.postponeRun(state.storage, "early-run", at(1));
    return {
      all: store.nextDueRuns(state.storage, at(10), 10),
      one: store.nextDueRuns(state.storage, at(10), 1),
      none: store.nextDueRuns(state.storage, at(10), 0),
      notYet: store.nextDueRuns(state.storage, at(0), 10),
      leftOut: store.nextDueRuns(state.storage, at(10), 10, ["early-run"]),
    };
  });

  expect(ids).toEqual({
    all: ["early-run", "late-run"],
    one: ["early-run"],
    none: [],
    notYet: [],
    leftOut: ["late-run"],
  });
});

test("earliestRunDueAt is undefined when no run is due, and skips the runs left out", async () => {
  const { agentId, threadId } = await agentWithThread("待つ");

  const dueAt = await runInDurableObject(userAgent(), (_, state) => {
    store.startRun(state.storage, {
      id: "only-run",
      agentId,
      threadId,
      text: "wait",
      startedAt: at(0),
    });
    store.waitForAnswer(state.storage, "only-run");
    const none = store.earliestRunDueAt(state.storage);
    store.postponeRun(state.storage, "only-run", at(5));
    return {
      none,
      due: store.earliestRunDueAt(state.storage),
      leftOut: store.earliestRunDueAt(state.storage, ["only-run"]),
    };
  });

  expect(dueAt).toEqual({ none: undefined, due: at(5), leftOut: undefined });
});

test("a task does not start while a run in its thread waits for an answer, but does once that run is postponed", async () => {
  const { agentId, threadId } = await agentWithThread("質問する");

  const started = await runInDurableObject(userAgent(), (_, state) => {
    store.insertTask(state.storage, {
      id: "task-1",
      agentId,
      threadId,
      prompt: "check",
      schedule: { cron: "0 8 * * *", timeZone: "UTC" },
      nextRunAt: at(0),
    });
    store.startRun(state.storage, {
      id: "asking-run",
      agentId,
      threadId,
      text: "ask",
      startedAt: at(1),
    });
    store.waitForAnswer(state.storage, "asking-run");
    const whileWaiting = store.nextDueTask(state.storage, at(10))?.id;
    store.postponeRun(state.storage, "asking-run", at(3));
    const afterPostpone = store.nextDueTask(state.storage, at(10))?.id;
    return { whileWaiting, afterPostpone };
  });

  expect(started).toEqual({ whileWaiting: undefined, afterPostpone: "task-1" });
});

test("earlierInThread throws for a run that isn't there", async () => {
  const missing = runInDurableObject(userAgent(), (_, state) => [
    ...store.earlierInThread(state.storage, "no-such-run"),
  ]);

  await expect(missing).rejects.toThrow("There is no run no-such-run");
});
