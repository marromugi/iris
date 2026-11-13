import {
  type Agent,
  DEFAULT_MAX_STEPS,
  type ImageBytes,
  type Message,
  type ModelProgress,
  run,
  type Tool,
} from "@iris/agent";
import { MAX_ATTACHMENT_BYTES } from "./attachment";
import { type ConsultContext, consultTool, RunCut } from "./consult";
import { nextSummaryDueAt, runsWaitingForSummaries } from "./daily-summary";
import { MAX_ATTACHMENTS_PER_POST } from "./message";
import { dayOfRun } from "./run-day";
import { nextRunAt } from "./schedule";
import * as store from "./store";
import { systemPromptOfRun } from "./system-prompt";

/**
 * How long after an attempt at a run started, or after it failed, the run is tried again. The wait
 * from the start covers an attempt cut off before it could end or record a failure.
 */
export const RETRY_DELAY_MS = 5 * 60 * 1000;

/** How many failed attempts a run gets before it is given up, so a run that keeps failing can't keep calling the model. */
export const MAX_FAILED_ATTEMPTS = 3;

/** How many messages of what came before in the thread the model reads at most, before the run's own. */
export const MAX_EARLIER_MESSAGES = 40;

/**
 * How many images, and how many of their bytes, one model request carries at most, within what
 * the Anthropic API takes in one request (32MB, base64 adding a third) and what a Durable Object
 * holds in memory. One post's images always fit.
 */
export const MAX_IMAGES_PER_REQUEST = 20;
export const MAX_IMAGE_BYTES_PER_REQUEST = MAX_ATTACHMENTS_PER_POST * MAX_ATTACHMENT_BYTES;

/** Reads an image's bytes by its ID; undefined when they aren't kept. */
export type ReadAttachment = (attachmentId: string) => Promise<Uint8Array | undefined>;

/** How a run is getting on while it is carried on: picked up, then the model's progress on each message. */
export type RunProgress = { readonly type: "starting" } | ModelProgress;

/** Hears what happens to runs while `runDue` works, for anyone watching them as they happen. */
export interface RunWatcher {
  /** A run started, got a message, or ended or failed an attempt; read it again to see how. */
  changed(runId: string): void;
  progress(runId: string, progress: RunProgress): void;
  /** A run stopped for this wake-up without ending; it is no longer being carried on. */
  stopped(runId: string): void;
  /** A post was sent, such as an agent's question in a consult. */
  posted(post: store.PostWithAttachments): void;
}

const nobodyWatching: RunWatcher = { changed() {}, progress() {}, stopped() {}, posted() {} };

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
    posted(post) {
      try {
        watcher.posted(post);
      } catch (error) {
        console.error(`Telling the watcher that post ${post.id} was sent failed.`, error);
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
 * run included; runs that started together, such as the replies to one post, go side by side. It
 * also waits while a summary of an earlier day of its thread can be written and isn't yet
 * (`runsWaitingForSummaries`), so it reads that summary.
 *
 * While `alongside`, other work of the same wake-up, goes on, it keeps starting work that
 * becomes due, and returns only once that work is done too.
 *
 * Once `WAKE_UP_BUDGET_MS` has passed since it began, nothing new starts, and each run going on
 * stops after its current message and is due again at once, so the next wake-up carries it on.
 *
 * The images in what each run's model reads have their bytes read by `readAttachment`; without
 * it, none are read.
 */
export async function runDue(
  storage: DurableObjectStorage,
  agent: RunAgent,
  now: () => Date,
  watching: RunWatcher = nobodyWatching,
  waker: Waker = new Waker(),
  toolsFor: (run: RunOf) => RunTools = () => ({ tools: [] }),
  alongside: Promise<void> = Promise.resolve(),
  readAttachment: ReadAttachment = async () => undefined,
): Promise<Date | undefined> {
  let alongsideDone = false;
  // Its failure is the caller's to hear; here it only ends the wait.
  const alongsideEnded = alongside
    .catch(() => undefined)
    .finally(() => {
      alongsideDone = true;
    });
  const watcher = safely(watching);
  const stopAt = now().getTime() + WAKE_UP_BUDGET_MS;
  const outOfTime = () => now().getTime() >= stopAt;
  const going = new Map<string, Promise<void>>();
  // Runs waiting for another run's answer don't count against the limit, so the answer can start.
  const waiting = new Set<string>();
  for (;;) {
    if (!outOfTime()) {
      startDueTasks(storage, now, watcher);
      const room = MAX_PARALLEL_RUNS - (going.size - waiting.size);
      const leftOut = [...going.keys(), ...runsWaitingForSummaries(storage)];
      for (const runId of store.nextDueRuns(storage, now(), room, leftOut)) {
        const tools = runTools({
          storage,
          runId,
          now,
          outOfTime,
          wake: () => waker.wake(),
          asked: (post, answerRunId) => {
            watcher.posted(post);
            watcher.changed(answerRunId);
            // The asking run now has the consult, which can be opened while it waits.
            watcher.changed(runId);
          },
          waiting: (isWaiting) => {
            if (isWaiting) {
              waiting.add(runId);
            } else {
              waiting.delete(runId);
            }
            waker.wake();
          },
        });
        const own = toolsFor({ runId, agentId: store.agentOfRun(storage, runId) ?? "" });
        const withTools = {
          ...agent,
          system: systemPromptOfRun(storage, runId, agent.modelName) ?? agent.system,
          tools: [...agent.tools, ...own.tools, ...tools],
        };
        going.set(
          runId,
          carryOn(storage, withTools, runId, now, watcher, outOfTime, readAttachment).finally(
            async () => {
              try {
                await own.release?.();
              } catch (error) {
                console.error(`Letting go of run ${runId}'s tools failed.`, error);
              }
              going.delete(runId);
              waiting.delete(runId);
            },
          ),
        );
      }
    }
    if (going.size === 0 && alongsideDone) {
      return nextWakeAt(storage);
    }
    await Promise.race([
      ...going.values(),
      waker.next(),
      ...(alongsideDone ? [] : [alongsideEnded]),
    ]);
  }
}

/** The tools a run is offered on top of its agent's own: asking another agent, unless it is in a consult. */
function runTools(context: ConsultContext): Tool[] {
  const consult = consultTool(context);
  return consult === undefined ? [] : [consult];
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

/**
 * The earliest of the next task time, the due times of runs next in line that aren't waiting for
 * a summary, and the next summary's.
 */
export function nextWakeAt(storage: DurableObjectStorage): Date | undefined {
  const times = [
    store.earliestTaskRunAt(storage),
    store.earliestRunDueAt(storage, runsWaitingForSummaries(storage)),
    nextSummaryDueAt(storage),
  ].filter((time) => time !== undefined);
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

/** Which run, of which agent, tools are made for. */
export interface RunOf {
  readonly runId: string;
  readonly agentId: string;
}

/**
 * The tools a run gets for its own agent, and what lets go of what they hold, such as a browser,
 * once the run stops for this wake-up: ended, failed, or cut.
 */
export interface RunTools {
  readonly tools: Tool[];
  readonly release?: () => Promise<void>;
}

/** The agent every run uses, with the name of the model it thinks with, which each run is told. */
export interface RunAgent extends Agent {
  readonly modelName: string;
}

/**
 * The bytes of the images the run's model reads: those in the run's own messages first, then those
 * in `earlier` (oldest first), the latest first, as many as fit in `MAX_IMAGES_PER_REQUEST` and
 * `MAX_IMAGE_BYTES_PER_REQUEST`. An image left out, or whose bytes aren't kept, has no entry.
 */
export async function readImages(
  storage: DurableObjectStorage,
  own: readonly Message[],
  earlier: readonly Message[],
  readAttachment: ReadAttachment,
): Promise<Map<string, ImageBytes>> {
  const chosen: store.Attachment[] = [];
  let size = 0;
  for (const message of [...own, ...earlier.toReversed()]) {
    for (const { id } of message.role === "user" ? (message.images ?? []) : []) {
      const attachment = store.findAttachment(storage, id);
      if (
        attachment === undefined ||
        chosen.length >= MAX_IMAGES_PER_REQUEST ||
        size + attachment.size > MAX_IMAGE_BYTES_PER_REQUEST
      ) {
        continue;
      }
      chosen.push(attachment);
      size += attachment.size;
    }
  }
  const read = await Promise.all(
    chosen.map(async ({ id, mediaType }) => {
      const bytes = await readAttachment(id);
      return bytes === undefined ? [] : [[id, { mediaType, bytes }] as const];
    }),
  );
  return new Map(read.flat());
}

/** A run with no steps left: it ends where it is. */
async function* noSteps(): AsyncGenerator<Message, void, undefined> {}

/**
 * Carries the run on from its saved messages until it ends, it has taken `DEFAULT_MAX_STEPS`
 * steps in all, or `outOfTime` says so after a message, when it is due again at once. A run ended
 * meanwhile by deactivating its agent stops there and saves nothing more.
 */
async function carryOn(
  storage: DurableObjectStorage,
  agent: Agent,
  runId: string,
  now: () => Date,
  watcher: RunWatcher,
  outOfTime: () => boolean,
  readAttachment: ReadAttachment,
): Promise<void> {
  store.postponeRun(storage, runId, new Date(now().getTime() + RETRY_DELAY_MS));
  watcher.progress(runId, { type: "starting" });
  try {
    const earlier = earlierMessages(
      store.earlierInThread(storage, runId, dayOfRun(storage, runId)?.startsAt),
      MAX_EARLIER_MESSAGES,
    );
    const conversation = store.loadConversation(storage, runId);
    // Read once for the run's model calls of this wake-up; the stored messages keep only references.
    const images = await readImages(storage, conversation, earlier, readAttachment);
    const withImages: Agent = { ...agent, model: (request) => agent.model({ ...request, images }) };
    let seq = conversation.length;
    // Steps count across attempts and wake-ups: the run's own messages after its first are the
    // steps it has taken.
    const stepsLeft = DEFAULT_MAX_STEPS - (conversation.length - 1);
    // A run ended meanwhile, by deactivating its agent, tells no more of how it is getting on.
    const onProgress = (progress: ModelProgress) => {
      if (!store.hasRunEnded(storage, runId)) {
        watcher.progress(runId, progress);
      }
    };
    const steps =
      stepsLeft > 0
        ? run(withImages, [...earlier, ...conversation], { onProgress, maxSteps: stepsLeft })
        : noSteps();
    for await (const message of steps) {
      if (store.hasRunEnded(storage, runId)) {
        watcher.stopped(runId);
        return;
      }
      store.appendMessage(storage, runId, seq, message);
      seq += 1;
      // Still being carried on: not due again until an attempt cut off here would be.
      store.postponeRun(storage, runId, new Date(now().getTime() + RETRY_DELAY_MS));
      watcher.changed(runId);
      if (outOfTime()) {
        store.postponeRun(storage, runId, now());
        watcher.stopped(runId);
        return;
      }
    }
    if (store.hasRunEnded(storage, runId)) {
      watcher.stopped(runId);
      return;
    }
    store.endRun(storage, runId, now());
    watcher.changed(runId);
  } catch (error) {
    if (store.hasRunEnded(storage, runId)) {
      watcher.stopped(runId);
      return;
    }
    if (error instanceof RunCut) {
      store.postponeRun(storage, runId, now());
      watcher.stopped(runId);
      return;
    }
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
