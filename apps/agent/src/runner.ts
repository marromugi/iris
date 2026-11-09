import { type Agent, run } from "@iris/agent";
import { nextRunAt } from "./schedule";
import * as store from "./store";

/** How long after a run was last tried it is carried on, for example after its model call failed. */
export const RETRY_DELAY_MS = 5 * 60 * 1000;

/** How many failed attempts a run gets before it is given up, so a run that keeps failing can't keep calling the model. */
export const MAX_FAILED_ATTEMPTS = 3;

/**
 * Does one piece of work that is due, then returns when to wake up next (a time already passed
 * when more work is due), or undefined when nothing is waiting. One piece per wake-up keeps each
 * wake-up within the platform's time limit however much is due.
 *
 * The piece is, first, a run that hasn't ended and whose retry time has come: it is carried on
 * from its saved messages. Otherwise it is the task whose time came first: a run of it starts and
 * the task moves to its next time after now, so a task that missed several times runs once. A
 * run that throws keeps its messages so far and is tried again `RETRY_DELAY_MS` later, until it
 * has failed `MAX_FAILED_ATTEMPTS` times and is given up.
 */
export async function runNext(
  storage: DurableObjectStorage,
  agent: Agent,
  now: () => Date,
): Promise<Date | undefined> {
  const retry = store.unendedRuns(storage).find((unended) => retryAt(unended) <= now());
  if (retry !== undefined) {
    await carryOn(storage, agent, retry.id, now);
    return nextWakeAt(storage);
  }
  const task = store.nextDueTask(storage, now());
  if (task !== undefined) {
    const runId = crypto.randomUUID();
    const startedAt = now();
    store.startRun(storage, {
      id: runId,
      task,
      startedAt,
      taskNextRunAt: nextRunAt(task.schedule, startedAt),
    });
    await carryOn(storage, agent, runId, now);
  }
  return nextWakeAt(storage);
}

/** The earliest of the next task time and the retry times of runs that haven't ended. */
export function nextWakeAt(storage: DurableObjectStorage): Date | undefined {
  const times = [
    store.earliestTaskRunAt(storage),
    ...store.unendedRuns(storage).map(retryAt),
  ].filter((time) => time !== undefined);
  return times.length === 0
    ? undefined
    : new Date(Math.min(...times.map((time) => time.getTime())));
}

function retryAt(unended: store.UnendedRun): Date {
  return new Date(unended.lastTriedAt.getTime() + RETRY_DELAY_MS);
}

async function carryOn(
  storage: DurableObjectStorage,
  agent: Agent,
  runId: string,
  now: () => Date,
): Promise<void> {
  try {
    const conversation = store.loadConversation(storage, runId);
    let seq = conversation.length;
    for await (const message of run(agent, conversation)) {
      store.appendMessage(storage, runId, seq, message);
      seq += 1;
    }
    store.endRun(storage, runId, now());
  } catch (error) {
    const failedAt = now();
    const failed = store.recordRunFailure(storage, runId, {
      error: error instanceof Error ? error.message : String(error),
      failedAt,
    });
    if (failed >= MAX_FAILED_ATTEMPTS) {
      console.error(`Run ${runId} failed ${failed} times and is given up.`, error);
      store.giveUpRun(storage, runId, failedAt);
    } else {
      console.error(`Run ${runId} failed and will be tried again later.`, error);
    }
  }
}
