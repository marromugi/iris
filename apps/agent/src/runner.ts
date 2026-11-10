import { type Agent, type Message, nextAction, run } from "@iris/agent";
import { nextRunAt } from "./schedule";
import * as store from "./store";

/**
 * How long after an attempt at a run started, or after it failed, the run is tried again. The wait
 * from the start covers an attempt cut off before it could end or record a failure.
 */
export const RETRY_DELAY_MS = 5 * 60 * 1000;

/** How many failed attempts a run gets before it is given up, so a run that keeps failing can't keep calling the model. */
export const MAX_FAILED_ATTEMPTS = 3;

/** How many messages of the agent's earlier runs the model reads at most, before the run's own. */
export const MAX_EARLIER_MESSAGES = 40;

/**
 * Does one piece of work that is due, then returns when to wake up next (a time already passed
 * when more work is due), or undefined when nothing is waiting. One piece per wake-up keeps each
 * wake-up within the platform's time limit however much is due.
 *
 * The piece is, first, the run that hasn't ended whose due time came first: one a message started,
 * or one to try again. It is carried on from its saved messages. Otherwise it is the task whose
 * time came first: a run of it starts and the task moves to its next time after now, so a task
 * that missed several times runs once. A run that throws keeps its messages so far and is due
 * again `RETRY_DELAY_MS` later, until it has failed `MAX_FAILED_ATTEMPTS` times and is given up.
 */
export async function runNext(
  storage: DurableObjectStorage,
  agent: Agent,
  now: () => Date,
): Promise<Date | undefined> {
  const due = store.nextDueRun(storage, now());
  if (due !== undefined) {
    await carryOn(storage, agent, due, now);
    return nextWakeAt(storage);
  }
  const task = store.nextDueTask(storage, now());
  if (task !== undefined) {
    const runId = crypto.randomUUID();
    const startedAt = now();
    store.startRun(storage, {
      id: runId,
      agentId: task.agentId,
      text: task.prompt,
      startedAt,
      task: { id: task.id, nextRunAt: nextRunAt(task.schedule, startedAt) },
    });
    await carryOn(storage, agent, runId, now);
  }
  return nextWakeAt(storage);
}

/** The earliest of the next task time and the due times of runs that haven't ended. */
export function nextWakeAt(storage: DurableObjectStorage): Date | undefined {
  const times = [store.earliestTaskRunAt(storage), store.earliestRunDueAt(storage)].filter(
    (time) => time !== undefined,
  );
  return times.length === 0
    ? undefined
    : new Date(Math.min(...times.map((time) => time.getTime())));
}

/**
 * What the model reads of the agent's earlier runs, oldest first: the latest whole runs that
 * finished with a reply, as many as fit in `limit` messages. `conversations` comes latest first;
 * a run that didn't finish, because it is still going or was given up, is passed over.
 */
export function earlierMessages(conversations: Iterable<Message[]>, limit: number): Message[] {
  const taken: Message[][] = [];
  let count = 0;
  for (const conversation of conversations) {
    if (nextAction(conversation).type !== "done") {
      continue;
    }
    if (count + conversation.length > limit) {
      break;
    }
    taken.push(conversation);
    count += conversation.length;
  }
  return taken.toReversed().flat();
}

async function carryOn(
  storage: DurableObjectStorage,
  agent: Agent,
  runId: string,
  now: () => Date,
): Promise<void> {
  store.postponeRun(storage, runId, new Date(now().getTime() + RETRY_DELAY_MS));
  try {
    const earlier = earlierMessages(
      store.earlierConversations(storage, runId),
      MAX_EARLIER_MESSAGES,
    );
    const conversation = store.loadConversation(storage, runId);
    let seq = conversation.length;
    for await (const message of run(agent, [...earlier, ...conversation])) {
      store.appendMessage(storage, runId, seq, message);
      seq += 1;
    }
    store.endRun(storage, runId, now());
  } catch (error) {
    const failedAt = now();
    const failed = store.recordRunFailure(storage, runId, {
      error: error instanceof Error ? error.message : String(error),
      retryAt: new Date(failedAt.getTime() + RETRY_DELAY_MS),
    });
    if (failed >= MAX_FAILED_ATTEMPTS) {
      console.error(`Run ${runId} failed ${failed} times and is given up.`, error);
      store.giveUpRun(storage, runId, failedAt);
    } else {
      console.error(`Run ${runId} failed and will be tried again later.`, error);
    }
  }
}
