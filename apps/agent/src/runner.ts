import { type Agent, run } from "@iris/agent";
import { nextRunAt } from "./schedule";
import * as store from "./store";

/** How long to wait before trying a failed run again, for example one whose model call failed. */
export const RETRY_DELAY_MS = 5 * 60 * 1000;

/**
 * Carries on every run that hasn't ended, then starts a run for each task that is due. A due task
 * that missed several times (the object was down) runs once and moves to its next time after now.
 * A run that throws keeps its messages so far, gets its error recorded, and is carried on at the
 * next wake-up. Returns when to wake up next, or undefined when nothing is waiting.
 */
export async function runDue(
  storage: DurableObjectStorage,
  agent: Agent,
  now: () => Date,
): Promise<Date | undefined> {
  for (const runId of store.unendedRunIds(storage)) {
    await carryOn(storage, agent, runId, now);
  }
  for (const task of store.dueTasks(storage, now())) {
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
  return nextWakeAt(storage, now());
}

/** The earliest of the next task time and, while a run hasn't ended, the time to try it again. */
export function nextWakeAt(storage: DurableObjectStorage, now: Date): Date | undefined {
  const taskAt = store.earliestTaskRunAt(storage);
  if (store.unendedRunIds(storage).length === 0) {
    return taskAt;
  }
  const retryAt = new Date(now.getTime() + RETRY_DELAY_MS);
  return taskAt === undefined || retryAt < taskAt ? retryAt : taskAt;
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
    console.error(`Run ${runId} failed and will be carried on at the next wake-up.`, error);
    store.recordRunError(storage, runId, error instanceof Error ? error.message : String(error));
  }
}
