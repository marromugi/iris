import { type Agent, type Message, type ModelProgress, run } from "@iris/agent";
import { nextRunAt } from "./schedule";
import * as store from "./store";

/**
 * How long after an attempt at a run started, or after it failed, the run is tried again. The wait
 * from the start covers an attempt cut off before it could end or record a failure.
 */
export const RETRY_DELAY_MS = 5 * 60 * 1000;

/** How many failed attempts a run gets before it is given up, so a run that keeps failing can't keep calling the model. */
export const MAX_FAILED_ATTEMPTS = 3;

/** How many messages of what came before in the thread the model reads at most, before the run's own. */
export const MAX_EARLIER_MESSAGES = 40;

/** How a run is getting on while it is carried on: picked up, then the model's progress on each message. */
export type RunProgress = { readonly type: "starting" } | ModelProgress;

/** Hears what happens to runs while `runDue` works, for anyone watching them as they happen. */
export interface RunWatcher {
  /** A run started, got a message, or ended or failed an attempt; read it again to see how. */
  changed(runId: string): void;
  progress(runId: string, progress: RunProgress): void;
  /** A run stopped for this wake-up without ending; it is no longer being carried on. */
  stopped(runId: string): void;
}

const nobodyWatching: RunWatcher = { changed() {}, progress() {}, stopped() {} };

/** The watcher with its failures logged instead of thrown: watching a run never changes how the run goes. */
function safely(watcher: RunWatcher): RunWatcher {
  return {
    changed(runId) {
      try {
        watcher.changed(runId);
      } catch (error) {
        console.error(`Telling the watcher that run ${runId} changed failed.`, error);
      }
    },
    progress(runId, progress) {
      try {
        watcher.progress(runId, progress);
      } catch (error) {
        console.error(`Telling the watcher how run ${runId} is getting on failed.`, error);
      }
    },
    stopped(runId) {
      try {
        watcher.stopped(runId);
      } catch (error) {
        console.error(`Telling the watcher that run ${runId} stopped failed.`, error);
      }
    },
  };
}

/** How many runs one wake-up carries on at the same time at most. A Worker waits on six connections at once. */
export const MAX_PARALLEL_RUNS = 6;

/**
 * How long a wake-up starts and carries on runs before it stops, short of the platform's 15
 * minutes for an alarm, so it can save where each run got to.
 */
export const WAKE_UP_BUDGET_MS = 13 * 60 * 1000;

/**
 * Lets a wake-up that is carrying on runs hear that more work may be due, such as a post just
 * sent, so it starts that work without waiting for a run to end.
 */
export class Waker {
  private woken: Promise<void> | undefined;
  private wakeUp: (() => void) | undefined;

  /** Resolves at the next `wake()`. */
  next(): Promise<void> {
    this.woken ??= new Promise((resolve) => {
      this.wakeUp = resolve;
    });
    return this.woken;
  }

  wake(): void {
    this.wakeUp?.();
    this.woken = undefined;
    this.wakeUp = undefined;
  }
}

/**
 * Carries on all the work that is due, several runs at the same time, then returns when to wake
 * up next (a time already passed when more work is due), or undefined when nothing is waiting.
 *
 * Due runs are carried on from their saved messages, up to `MAX_PARALLEL_RUNS` at once; as each
 * ends, and whenever `waker` wakes, more due work is started. A task whose time came starts a run
 * and moves to its next time after now, so a task that missed several times runs once. A run that
 * throws keeps its messages so far and is due again `RETRY_DELAY_MS` later, until it has failed
 * `MAX_FAILED_ATTEMPTS` times and is given up.
 *
 * A run waits while a run of the same thread that started before it hasn't ended, the task's new
 * run included; runs that started together, such as the replies to one post, go side by side.
 *
 * Once `WAKE_UP_BUDGET_MS` has passed since it began, nothing new starts, and each run going on
 * stops after its current message and is due again at once, so the next wake-up carries it on.
 */
export async function runDue(
  storage: DurableObjectStorage,
  agent: Agent,
  now: () => Date,
  watching: RunWatcher = nobodyWatching,
  waker: Waker = new Waker(),
): Promise<Date | undefined> {
  const watcher = safely(watching);
  const stopAt = now().getTime() + WAKE_UP_BUDGET_MS;
  const outOfTime = () => now().getTime() >= stopAt;
  const going = new Map<string, Promise<void>>();
  for (;;) {
    if (!outOfTime()) {
      startDueTasks(storage, now, watcher);
      for (const runId of store.nextDueRuns(storage, now(), MAX_PARALLEL_RUNS - going.size)) {
        going.set(
          runId,
          carryOn(storage, agent, runId, now, watcher, outOfTime).finally(() =>
            going.delete(runId),
          ),
        );
      }
    }
    if (going.size === 0) {
      return nextWakeAt(storage);
    }
    await Promise.race([...going.values(), waker.next()]);
  }
}

/** Starts a run of each task whose time came, and moves the task to its next time after now. */
function startDueTasks(storage: DurableObjectStorage, now: () => Date, watcher: RunWatcher): void {
  for (
    let task = store.nextDueTask(storage, now());
    task !== undefined;
    task = store.nextDueTask(storage, now())
  ) {
    const runId = crypto.randomUUID();
    const startedAt = now();
    store.startRun(storage, {
      id: runId,
      agentId: task.agentId,
      threadId: task.threadId,
      text: task.prompt,
      startedAt,
      task: { id: task.id, nextRunAt: nextRunAt(task.schedule, startedAt) },
    });
    watcher.changed(runId);
  }
}

/** The earliest of the next task time and the due times of runs next in line. */
export function nextWakeAt(storage: DurableObjectStorage): Date | undefined {
  const times = [store.earliestTaskRunAt(storage), store.earliestRunDueAt(storage)].filter(
    (time) => time !== undefined,
  );
  return times.length === 0
    ? undefined
    : new Date(Math.min(...times.map((time) => time.getTime())));
}

/**
 * What the model reads of what came before the run, oldest first: the latest whole entries of
 * `earlier`, which comes latest first, as many as fit in `limit` messages.
 */
export function earlierMessages(earlier: Iterable<Message[]>, limit: number): Message[] {
  const taken: Message[][] = [];
  let count = 0;
  for (const entry of earlier) {
    if (count + entry.length > limit) {
      break;
    }
    taken.push(entry);
    count += entry.length;
  }
  return taken.toReversed().flat();
}

/**
 * Carries the run on from its saved messages until it ends, or until `outOfTime` says so after a
 * message, when it is due again at once.
 */
async function carryOn(
  storage: DurableObjectStorage,
  agent: Agent,
  runId: string,
  now: () => Date,
  watcher: RunWatcher,
  outOfTime: () => boolean,
): Promise<void> {
  store.postponeRun(storage, runId, new Date(now().getTime() + RETRY_DELAY_MS));
  watcher.progress(runId, { type: "starting" });
  try {
    const earlier = earlierMessages(store.earlierInThread(storage, runId), MAX_EARLIER_MESSAGES);
    const conversation = store.loadConversation(storage, runId);
    let seq = conversation.length;
    const onProgress = (progress: ModelProgress) => watcher.progress(runId, progress);
    for await (const message of run(agent, [...earlier, ...conversation], { onProgress })) {
      store.appendMessage(storage, runId, seq, message);
      seq += 1;
      watcher.changed(runId);
      if (outOfTime()) {
        store.postponeRun(storage, runId, now());
        watcher.stopped(runId);
        return;
      }
    }
    store.endRun(storage, runId, now());
    watcher.changed(runId);
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
    watcher.changed(runId);
  }
}
