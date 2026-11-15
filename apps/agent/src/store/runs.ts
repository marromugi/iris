import { type Message, nextAction } from "@iris/agent";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  min,
  notExists,
  notInArray,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { messages, posts, runs, tasks, threads } from "../db/schema";
import { listAgents } from "./agents";
import { withAttachments } from "./attachments";
import {
  earlierRuns,
  loadConversation,
  messageRow,
  replyText,
  withoutReasoning,
} from "./conversation";
import { database } from "./database";
import { type PostWithAttachments, postAsRead } from "./posts";
import { type Thread, readThreads } from "./threads";

/**
 * Starts a run of the agent with `text` as its first message, due at once. A run of a task also
 * moves the task to its next run time in the same transaction: a task is never started twice for
 * the same time. Runs that reply to a post are started with `insertPost`.
 */
export function startRun(
  storage: DurableObjectStorage,
  run: {
    id: string;
    agentId: string;
    threadId: string;
    text: string;
    startedAt: Date;
    task?: { id: string; nextRunAt: Date };
  },
): void {
  database(storage).transaction((tx) => {
    if (run.task !== undefined) {
      tx.update(tasks)
        .set({ nextRunAt: run.task.nextRunAt })
        .where(eq(tasks.id, run.task.id))
        .run();
    }
    tx.insert(runs)
      .values({
        id: run.id,
        agentId: run.agentId,
        threadId: run.threadId,
        taskId: run.task?.id ?? null,
        startedAt: run.startedAt,
        dueAt: run.startedAt,
      })
      .run();
    tx.insert(messages)
      .values(messageRow(run.id, 0, { role: "user", text: run.text }))
      .run();
  });
}

/**
 * Runs next in line: the runs of each thread that no run started earlier in the same thread is
 * still ahead of. A run waits until the thread's runs that started before it have ended, so it
 * reads them; runs that started together, such as the replies to one post, don't wait for each
 * other.
 */
function nextInLine(storage: DurableObjectStorage) {
  return and(
    isNull(runs.endedAt),
    notExists(
      database(storage)
        .select({ id: earlierRuns.id })
        .from(earlierRuns)
        .where(
          and(
            eq(earlierRuns.threadId, runs.threadId),
            isNull(earlierRuns.endedAt),
            lt(earlierRuns.startedAt, runs.startedAt),
          ),
        ),
    ),
  );
}

/** The ID of the run next in line whose due time came first, among every thread's runs due by `now`. */
export function nextDueRun(storage: DurableObjectStorage, now: Date): string | undefined {
  return nextDueRuns(storage, now, 1)[0];
}

/**
 * The IDs of up to `limit` runs next in line that are due by `now`, the earliest due first,
 * leaving out `leftOut`, such as the runs already being carried on.
 */
export function nextDueRuns(
  storage: DurableObjectStorage,
  now: Date,
  limit: number,
  leftOut: readonly string[] = [],
): string[] {
  if (limit <= 0) {
    return [];
  }
  return database(storage)
    .select({ id: runs.id })
    .from(runs)
    .where(and(nextInLine(storage), lte(runs.dueAt, now), notInArray(runs.id, [...leftOut])))
    .orderBy(asc(runs.dueAt), asc(runs.id))
    .limit(limit)
    .all()
    .map((row) => row.id);
}

/** When the earliest run next in line is due, leaving out `leftOut`. */
export function earliestRunDueAt(
  storage: DurableObjectStorage,
  leftOut: readonly string[] = [],
): Date | undefined {
  const row = database(storage)
    .select({ next: min(runs.dueAt) })
    .from(runs)
    .where(and(nextInLine(storage), notInArray(runs.id, [...leftOut])))
    .get();
  return row?.next ?? undefined;
}

/** Sets when the run is next due to be carried on. */
export function postponeRun(storage: DurableObjectStorage, runId: string, dueAt: Date): void {
  database(storage).update(runs).set({ dueAt }).where(eq(runs.id, runId)).run();
}

/**
 * Makes the run wait for the user's answer: it isn't due again until it is given a time. Reaching
 * the question is the run getting on, so earlier failed attempts no longer count against it.
 */
export function waitForAnswer(storage: DurableObjectStorage, runId: string): void {
  database(storage)
    .update(runs)
    .set({ dueAt: null, lastError: null, failedAttempts: 0 })
    .where(eq(runs.id, runId))
    .run();
}

/** Whether the run has ended, or is gone. */
export function hasRunEnded(storage: DurableObjectStorage, runId: string): boolean {
  const row = database(storage)
    .select({ endedAt: runs.endedAt })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();
  return row === undefined || row.endedAt !== null;
}

/** Ends a run that finished or reached its step limit, clearing any earlier failure. */
export function endRun(storage: DurableObjectStorage, runId: string, endedAt: Date): void {
  database(storage).update(runs).set({ endedAt, lastError: null }).where(eq(runs.id, runId)).run();
}

/** Ends a run that won't be tried again, keeping the error of its last attempt. */
export function giveUpRun(storage: DurableObjectStorage, runId: string, endedAt: Date): void {
  database(storage).update(runs).set({ endedAt }).where(eq(runs.id, runId)).run();
}

/**
 * Records a failed attempt, due again at `retryAt`, and returns how many attempts of the run have
 * failed so far.
 */
export function recordRunFailure(
  storage: DurableObjectStorage,
  runId: string,
  failure: { error: string; retryAt: Date },
): number {
  const row = database(storage)
    .update(runs)
    .set({
      lastError: failure.error,
      dueAt: failure.retryAt,
      failedAttempts: sql`${runs.failedAttempts} + 1`,
    })
    .where(eq(runs.id, runId))
    .returning({ failedAttempts: runs.failedAttempts })
    .get();
  if (row === undefined) {
    throw new Error(`There is no run ${runId} to record a failure for.`);
  }
  return row.failedAttempts;
}

export interface Run {
  readonly id: string;
  readonly agentId: string;
  readonly threadId: string;
  readonly taskId: string | null;
  /** The post it replies to; null for a run a task started. */
  readonly postId: string | null;
  readonly startedAt: Date;
  /**
   * Set once the run has finished, reached its step limit, or been given up after failing too
   * often; unset while it still has to be carried on.
   */
  readonly endedAt: Date | null;
  /** Why the last attempt failed. Cleared when a later attempt finishes; kept on a run given up. */
  readonly lastError: string | null;
  readonly failedAttempts: number;
  /** Whether it hasn't ended and waits for the user to answer its question. */
  readonly waitsForAnswer: boolean;
  readonly messages: Message[];
  /** The consults its agent asked in, by the tool call that asked. */
  readonly consults: readonly { readonly callId: string; readonly thread: Thread }[];
}

export function toRun(storage: DurableObjectStorage, row: typeof runs.$inferSelect): Run {
  return {
    id: row.id,
    agentId: row.agentId,
    threadId: row.threadId,
    taskId: row.taskId,
    postId: row.postId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    lastError: row.lastError,
    failedAttempts: row.failedAttempts,
    waitsForAnswer: row.endedAt === null && row.dueAt === null,
    messages: loadConversation(storage, row.id),
    consults: consultsOf(storage, row.id),
  };
}

/** The consults the run's agent asked in, by the tool call that asked, the first asked first. */
function consultsOf(
  storage: DurableObjectStorage,
  runId: string,
): { callId: string; thread: Thread }[] {
  const consults = new Map(
    readThreads(storage, eq(threads.consultRunId, runId)).map((thread) => [thread.id, thread]),
  );
  if (consults.size === 0) {
    return [];
  }
  return database(storage)
    .select({ callId: posts.callId, threadId: posts.threadId })
    .from(posts)
    .where(inArray(posts.threadId, [...consults.keys()]))
    .orderBy(asc(posts.createdAt), asc(posts.id))
    .all()
    .flatMap(({ callId, threadId }) => {
      const thread = consults.get(threadId);
      return callId === null || thread === undefined ? [] : [{ callId, thread }];
    });
}

export function agentOfRun(storage: DurableObjectStorage, runId: string): string | undefined {
  return database(storage)
    .select({ agentId: runs.agentId })
    .from(runs)
    .where(eq(runs.id, runId))
    .get()?.agentId;
}

export function threadOfRun(storage: DurableObjectStorage, runId: string): string | undefined {
  return database(storage)
    .select({ threadId: runs.threadId })
    .from(runs)
    .where(eq(runs.id, runId))
    .get()?.threadId;
}

export function findRun(storage: DurableObjectStorage, id: string): Run | undefined {
  const row = database(storage).select().from(runs).where(eq(runs.id, id)).get();
  return row === undefined ? undefined : toRun(storage, row);
}

/** The thread's latest runs first, each with its conversation. */
export function recentRuns(storage: DurableObjectStorage, threadId: string, limit: number): Run[] {
  return database(storage)
    .select()
    .from(runs)
    .where(eq(runs.threadId, threadId))
    .orderBy(desc(runs.startedAt), desc(runs.id))
    .limit(limit)
    .all()
    .map((row) => toRun(storage, row));
}

/**
 * What was said in the run's thread before it, as its agent reads it, the latest first, each
 * entry to be kept whole. An entry is a post together with the replies to it that ended with
 * one, or a run a task started that ended with a reply. The agent's own reply is its
 * conversation (without the post, which comes first, and without the model's reasoning); another
 * agent's is its reply as a user message after the agent's name. A post without such a reply, and a run without one (given up,
 * or stopped at its step limit), are passed over. Only what came from `from` until the run started
 * counts, so replies to the same post don't read each other. Conversations are read from storage only
 * when the caller asks for their entry.
 */
export function* earlierInThread(
  storage: DurableObjectStorage,
  runId: string,
  from: Date = new Date(0),
): Generator<Message[], void, undefined> {
  const db = database(storage);
  const run = db
    .select({ agentId: runs.agentId, threadId: runs.threadId, startedAt: runs.startedAt })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();
  if (run === undefined) {
    throw new Error(`There is no run ${runId} to read the earlier part of the thread for.`);
  }
  const agentNames = new Map(listAgents(storage).map((agent) => [agent.id, agent.name]));
  const earlierRunRows = db
    .select({
      id: runs.id,
      agentId: runs.agentId,
      postId: runs.postId,
      startedAt: runs.startedAt,
      endedAt: runs.endedAt,
    })
    .from(runs)
    .where(
      and(
        eq(runs.threadId, run.threadId),
        gte(runs.startedAt, from),
        lt(runs.startedAt, run.startedAt),
      ),
    )
    .orderBy(asc(runs.endedAt), asc(runs.id))
    .all();
  type EarlierRun = (typeof earlierRunRows)[number];
  const entries: ({ at: Date } & (
    | { post: PostWithAttachments; replies: EarlierRun[] }
    | { run: EarlierRun }
  ))[] = withAttachments(
    storage,
    db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.threadId, run.threadId),
          gte(posts.createdAt, from),
          lt(posts.createdAt, run.startedAt),
        ),
      )
      .all(),
  ).map((post) => ({
    at: post.createdAt,
    post,
    replies: earlierRunRows.filter((row) => row.postId === post.id),
  }));
  for (const row of earlierRunRows) {
    if (row.postId === null) {
      entries.push({ at: row.startedAt, run: row });
    }
  }
  /** The run as the agent reads it, or undefined when it didn't end with a reply. */
  const read = (row: EarlierRun): Message[] | undefined => {
    const conversation = loadConversation(storage, row.id);
    if (conversation.length === 0 || nextAction(conversation).type !== "done") {
      return undefined;
    }
    if (row.agentId !== run.agentId) {
      const name = agentNames.get(row.agentId) ?? "";
      return [{ role: "user", text: `${name}: ${replyText(conversation)}` }];
    }
    return (row.postId === null ? conversation : conversation.slice(1)).map(withoutReasoning);
  };
  for (const entry of entries.toSorted((a, b) => b.at.getTime() - a.at.getTime())) {
    if ("run" in entry) {
      const messagesRead = read(entry.run);
      if (messagesRead !== undefined) {
        yield messagesRead;
      }
      continue;
    }
    const replies = entry.replies.flatMap((reply) => read(reply) ?? []);
    if (replies.length > 0) {
      const attachmentIds = entry.post.attachments.map((attachment) => attachment.id);
      yield [postAsRead(entry.post, attachmentIds, agentNames), ...replies];
    }
  }
}

const waitingRuns = alias(runs, "waiting_runs");

/**
 * The task's thread has no run waiting for the user's answer. A task of such a thread starts no
 * run, which would only wait behind it, and sets no wake-up: once the answer comes, it runs once
 * and moves to its next time after then, like a task that missed several times.
 */
export function noRunWaitsForAnswer(storage: DurableObjectStorage) {
  return notExists(
    database(storage)
      .select({ id: waitingRuns.id })
      .from(waitingRuns)
      .where(
        and(
          eq(waitingRuns.threadId, tasks.threadId),
          isNull(waitingRuns.endedAt),
          isNull(waitingRuns.dueAt),
        ),
      ),
  );
}
