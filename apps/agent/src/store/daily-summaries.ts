import { nextAction } from "@iris/agent";
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, min, sql } from "drizzle-orm";
import { dailySummaries, posts, runs, threads } from "../db/schema";
import { answeredQuestions } from "../question";
import { agentNamesById } from "./agents";
import { loadConversation, replyText } from "./conversation";
import { database } from "./database";

/** A thread's day summary, written or not yet. */
export interface DailySummary {
  readonly threadId: string;
  readonly day: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly text: string | null;
  readonly failedAttempts: number;
  readonly retryAt: Date | null;
}

/** The threads days are summarized for: every thread but consults. */
export function summarizedThreadIds(storage: DurableObjectStorage): string[] {
  return database(storage)
    .select({ id: threads.id })
    .from(threads)
    .where(isNull(threads.consultRunId))
    .all()
    .map((row) => row.id);
}

/** The thread's summaries, the earliest first. */
export function dailySummariesOf(storage: DurableObjectStorage, threadId: string): DailySummary[] {
  return database(storage)
    .select({
      threadId: dailySummaries.threadId,
      day: dailySummaries.day,
      startsAt: dailySummaries.startsAt,
      endsAt: dailySummaries.endsAt,
      text: dailySummaries.text,
      failedAttempts: dailySummaries.failedAttempts,
      retryAt: dailySummaries.retryAt,
    })
    .from(dailySummaries)
    .where(eq(dailySummaries.threadId, threadId))
    .orderBy(asc(dailySummaries.endsAt))
    .all();
}

/** The thread's latest summary, written or not yet. */
export function latestDailySummary(
  storage: DurableObjectStorage,
  threadId: string,
): DailySummary | undefined {
  return database(storage)
    .select({
      threadId: dailySummaries.threadId,
      day: dailySummaries.day,
      startsAt: dailySummaries.startsAt,
      endsAt: dailySummaries.endsAt,
      text: dailySummaries.text,
      failedAttempts: dailySummaries.failedAttempts,
      retryAt: dailySummaries.retryAt,
    })
    .from(dailySummaries)
    .where(eq(dailySummaries.threadId, threadId))
    .orderBy(desc(dailySummaries.endsAt))
    .limit(1)
    .get();
}

/**
 * When something next happened in the thread from `after` on: the user posted, or a task started
 * a run. Undefined when nothing has.
 */
export function firstActivityFrom(
  storage: DurableObjectStorage,
  threadId: string,
  after: Date,
): Date | undefined {
  const db = database(storage);
  const post = db
    .select({ at: min(posts.createdAt) })
    .from(posts)
    .where(and(eq(posts.threadId, threadId), gte(posts.createdAt, after)))
    .get();
  const task = db
    .select({ at: min(runs.startedAt) })
    .from(runs)
    .where(and(eq(runs.threadId, threadId), isNotNull(runs.taskId), gte(runs.startedAt, after)))
    .get();
  const times = [post?.at, task?.at].filter((at) => at !== null && at !== undefined);
  return times.length === 0 ? undefined : new Date(Math.min(...times.map((at) => at.getTime())));
}

/** Whether a run of the thread that started before `before` hasn't ended. */
export function hasRunGoingFrom(
  storage: DurableObjectStorage,
  threadId: string,
  before: Date,
): boolean {
  return (
    database(storage)
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.threadId, threadId), lt(runs.startedAt, before), isNull(runs.endedAt)))
      .get() !== undefined
  );
}

/** The IDs of the thread's runs that started at or after `from` and haven't ended. */
export function unendedRunsStartedFrom(
  storage: DurableObjectStorage,
  threadId: string,
  from: Date,
): string[] {
  return database(storage)
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.threadId, threadId), gte(runs.startedAt, from), isNull(runs.endedAt)))
    .all()
    .map((row) => row.id);
}

/** One thing said in a thread, as a day's summary reads it. */
export interface SaidLine {
  readonly at: Date;
  /** Who said it: "User", an agent's name, or a task's run as "Task for <agent>". */
  readonly speaker: string;
  readonly text: string;
}

/**
 * What was said in the thread from `startsAt` until `endsAt`, in order, for a thread that isn't a
 * consult (where agents post): each post the user sent
 * then, followed by the replies to it that ended with one, and each run a task started then, as
 * its prompt followed by its reply. A reply is preceded by the questions its agent asked the user
 * with `ask_user` and the user's answers. Other tool calls, their results, and the model's
 * reasoning are left out.
 */
export function saidBetween(
  storage: DurableObjectStorage,
  threadId: string,
  startsAt: Date,
  endsAt: Date,
): SaidLine[] {
  const db = database(storage);
  const names = agentNamesById(storage);
  // An ended run's questions and answers, then its reply; nothing for a run without a reply.
  const replyLines = (run: { id: string; agentId: string; endedAt: Date | null }): SaidLine[] => {
    const conversation = loadConversation(storage, run.id);
    if (
      run.endedAt === null ||
      conversation.length === 0 ||
      nextAction(conversation).type !== "done"
    ) {
      return [];
    }
    const at = run.endedAt;
    const name = names.get(run.agentId) ?? "";
    return [
      ...answeredQuestions(conversation).flatMap(({ question, answer }) => [
        { at, speaker: name, text: question },
        { at, speaker: "User", text: answer },
      ]),
      { at, speaker: name, text: replyText(conversation) },
    ];
  };
  const inDay = (column: typeof posts.createdAt | typeof runs.startedAt) =>
    and(gte(column, startsAt), lt(column, endsAt));
  const said: { at: Date; lines: SaidLine[] }[] = [];
  const dayPosts = db
    .select()
    .from(posts)
    .where(and(eq(posts.threadId, threadId), inDay(posts.createdAt)))
    .all();
  for (const post of dayPosts) {
    const replies = db
      .select({ id: runs.id, agentId: runs.agentId, endedAt: runs.endedAt })
      .from(runs)
      .where(eq(runs.postId, post.id))
      .orderBy(asc(runs.endedAt), asc(runs.id))
      .all()
      .flatMap(replyLines);
    said.push({
      at: post.createdAt,
      lines: [
        {
          at: post.createdAt,
          speaker: "User",
          text: post.text,
        },
        ...replies,
      ],
    });
  }
  const taskRuns = db
    .select({
      id: runs.id,
      agentId: runs.agentId,
      startedAt: runs.startedAt,
      endedAt: runs.endedAt,
    })
    .from(runs)
    .where(and(eq(runs.threadId, threadId), isNotNull(runs.taskId), inDay(runs.startedAt)))
    .all();
  for (const run of taskRuns) {
    const name = names.get(run.agentId) ?? "";
    const [prompt] = loadConversation(storage, run.id);
    said.push({
      at: run.startedAt,
      lines: [
        {
          at: run.startedAt,
          speaker: `Task for ${name}`,
          text: prompt?.role === "user" ? prompt.text : "",
        },
        ...replyLines(run),
      ],
    });
  }
  return said.toSorted((a, b) => a.at.getTime() - b.at.getTime()).flatMap((entry) => entry.lines);
}

/** Stores the day's summary as written, in place of a failed attempt at it. */
export function saveDailySummary(
  storage: DurableObjectStorage,
  summary: { threadId: string; day: string; startsAt: Date; endsAt: Date; text: string },
): void {
  database(storage)
    .insert(dailySummaries)
    .values(summary)
    .onConflictDoUpdate({
      target: [dailySummaries.threadId, dailySummaries.endsAt],
      set: { text: summary.text, lastError: null, retryAt: null },
    })
    .run();
}

/**
 * Records a failed attempt at the day's summary, tried again at `retryAt`, and returns how many
 * attempts at it have failed so far.
 */
export function recordDailySummaryFailure(
  storage: DurableObjectStorage,
  summary: { threadId: string; day: string; startsAt: Date; endsAt: Date },
  failure: { error: string; retryAt: Date },
): number {
  const row = database(storage)
    .insert(dailySummaries)
    .values({ ...summary, failedAttempts: 1, lastError: failure.error, retryAt: failure.retryAt })
    .onConflictDoUpdate({
      target: [dailySummaries.threadId, dailySummaries.endsAt],
      set: {
        failedAttempts: sql`${dailySummaries.failedAttempts} + 1`,
        lastError: failure.error,
        retryAt: failure.retryAt,
      },
    })
    .returning({ failedAttempts: dailySummaries.failedAttempts })
    .get();
  return row?.failedAttempts ?? 1;
}
