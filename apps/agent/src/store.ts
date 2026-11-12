import { type Message, messageSchema, nextAction } from "@iris/agent";
import {
  and,
  count,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  min,
  notExists,
  notInArray,
  type SQL,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { alias } from "drizzle-orm/sqlite-core";
import migrations from "../drizzle/migrations";
import {
  agents,
  dailySummaries,
  mails,
  mailSetup,
  messages,
  posts,
  runs,
  searchCounts,
  settings,
  tasks,
  threadMembers,
  threads,
} from "./db/schema";
import type { Look } from "./agent";
import { DEFAULT_TIME_ZONE } from "./day";
import type { Mail } from "./mail/mail";
import type { MailConfirmation, MailState } from "./mail/setup";
import type { Schedule } from "./schedule";

/** The format messages are stored in. A stored message in any other format is refused, not guessed at. */
const MESSAGE_FORMAT = 1;

function database(storage: DurableObjectStorage) {
  return drizzle(storage);
}

/** One of the user's agents, with its look and when its latest run started (null until it first runs). */
export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly look: Look;
  readonly lastRanAt: Date | null;
  /** False while the agent is deactivated: it starts no run of its own and replies to nothing. */
  readonly active: boolean;
}

export interface Task {
  readonly id: string;
  readonly agentId: string;
  /** The thread its runs happen in. */
  readonly threadId: string;
  readonly prompt: string;
  readonly schedule: Schedule;
  readonly nextRunAt: Date;
}

/**
 * Applies, in one transaction, the migrations drizzle-kit generated that the storage hasn't had
 * yet, recording them in drizzle's `__drizzle_migrations` table. A failing statement's SQLite
 * error is thrown as is. Refuses storage that has a migration newer than any this code knows,
 * which a newer version of the code wrote.
 */
export function migrate(storage: DurableObjectStorage): void {
  // Not drizzle-orm's own migrator: on a failing statement it throws a bare "Rollback" error and
  // loses the SQLite error.
  storage.transactionSync(() => {
    storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
    );
    const latest = storage.sql
      .exec<{ latest: number | null }>("SELECT max(created_at) AS latest FROM __drizzle_migrations")
      .one().latest;
    const known = Math.max(0, ...migrations.journal.entries.map((entry) => entry.when));
    if (latest !== null && latest > known) {
      throw new Error(
        `Storage has a migration from ${new Date(latest).toISOString()}, newer than any this code knows.`,
      );
    }
    for (const entry of migrations.journal.entries) {
      if (latest !== null && entry.when <= latest) {
        continue;
      }
      const text = migrationText(entry.idx);
      if (text === undefined) {
        throw new Error(`Migration ${entry.tag} is in the journal but its SQL is missing.`);
      }
      for (const statement of text.split("--> statement-breakpoint")) {
        storage.sql.exec(statement);
      }
      storage.sql.exec(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('', ?)",
        entry.when,
      );
    }
  });
}

function migrationText(index: number): string | undefined {
  const sqlByKey: Record<string, string> = migrations.migrations;
  return sqlByKey[`m${index.toString().padStart(4, "0")}`];
}

/** Adds an agent together with its own one-to-one thread, of which it is the member. */
export function insertAgent(
  storage: DurableObjectStorage,
  agent: { id: string; name: string; look: Look; createdAt: Date },
): void {
  const threadId = crypto.randomUUID();
  database(storage).transaction((tx) => {
    tx.insert(agents)
      .values({
        id: agent.id,
        name: agent.name,
        lookPalette: agent.look.palette,
        lookSeed: agent.look.seed,
        createdAt: agent.createdAt,
      })
      .run();
    tx.insert(threads)
      .values({ id: threadId, agentId: agent.id, createdAt: agent.createdAt })
      .run();
    tx.insert(threadMembers).values({ threadId, agentId: agent.id }).run();
  });
}

/** Adds a group thread with the agents as its members. The caller checks that the agents are the user's. */
export function insertGroup(
  storage: DurableObjectStorage,
  group: { id: string; name: string; agentIds: readonly string[]; createdAt: Date },
): void {
  database(storage).transaction((tx) => {
    tx.insert(threads).values({ id: group.id, name: group.name, createdAt: group.createdAt }).run();
    tx.insert(threadMembers)
      .values(group.agentIds.map((agentId) => ({ threadId: group.id, agentId })))
      .run();
  });
}

/**
 * A thread: a group with its name, an agent's one-to-one thread with the agent's name and ID, or
 * a consult, named after the agent asked. `lastActivityAt` is when it was made, a post was sent,
 * or a run started, whichever came last.
 */
export interface Thread {
  readonly id: string;
  readonly name: string;
  /** The agent whose one-to-one thread this is; null for a group or a consult. */
  readonly agentId: string | null;
  /** For a consult, the run whose agent asked in it; null otherwise. */
  readonly consultRunId: string | null;
  /** The members in the order they were added as agents. */
  readonly agentIds: readonly string[];
  readonly lastActivityAt: Date;
}

/** The user's threads as the home lists them, the latest activity first: consults are left out. */
export function listThreads(storage: DurableObjectStorage): Thread[] {
  return readThreads(storage, isNull(threads.consultRunId));
}

/** One of the user's threads by its ID, a consult included. */
export function findThread(storage: DurableObjectStorage, id: string): Thread | undefined {
  return readThreads(storage, eq(threads.id, id))[0];
}

/**
 * The threads `where` picks, the latest activity first. Only their own posts, runs, and members
 * are read.
 */
function readThreads(storage: DurableObjectStorage, where: SQL | undefined): Thread[] {
  const db = database(storage);
  const rows = db.select().from(threads).where(where).all();
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((row) => row.id);
  const lastPostAt = new Map(
    db
      .select({ threadId: posts.threadId, at: max(posts.createdAt) })
      .from(posts)
      .where(inArray(posts.threadId, ids))
      .groupBy(posts.threadId)
      .all()
      .map((row) => [row.threadId, row.at]),
  );
  const lastRunAt = new Map(
    db
      .select({ threadId: runs.threadId, at: max(runs.startedAt) })
      .from(runs)
      .where(inArray(runs.threadId, ids))
      .groupBy(runs.threadId)
      .all()
      .map((row) => [row.threadId, row.at]),
  );
  const members = threadMembersById(storage, ids);
  const agentNames = agentNamesById(storage);
  return rows
    .map((row): Thread => {
      const times = [row.createdAt, lastPostAt.get(row.id), lastRunAt.get(row.id)]
        .filter((time) => time !== undefined && time !== null)
        .map((time) => time.getTime());
      return {
        id: row.id,
        name: row.name ?? agentNames.get(row.agentId ?? "") ?? "",
        agentId: row.agentId,
        consultRunId: row.consultRunId,
        agentIds: members.get(row.id) ?? [],
        lastActivityAt: new Date(Math.max(...times)),
      };
    })
    .toSorted(
      (a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime() || a.id.localeCompare(b.id),
    );
}

/** The member IDs of the threads `ids`, in the order the agents were added. */
function threadMembersById(
  storage: DurableObjectStorage,
  ids: readonly string[],
): Map<string, string[]> {
  const byThread = new Map<string, string[]>();
  for (const row of database(storage)
    .select({ threadId: threadMembers.threadId, agentId: threadMembers.agentId })
    .from(threadMembers)
    .innerJoin(agents, eq(agents.id, threadMembers.agentId))
    .where(inArray(threadMembers.threadId, [...ids]))
    .orderBy(asc(agents.createdAt), asc(agents.id))
    .all()) {
    byThread.set(row.threadId, [...(byThread.get(row.threadId) ?? []), row.agentId]);
  }
  return byThread;
}

/** The ID of the agent's own one-to-one thread; undefined when the user has no such agent. */
export function agentThreadId(storage: DurableObjectStorage, agentId: string): string | undefined {
  return database(storage)
    .select({ id: threads.id })
    .from(threads)
    .where(eq(threads.agentId, agentId))
    .get()?.id;
}

/** The user's agents in the order they were added. */
export function listAgents(storage: DurableObjectStorage): Agent[] {
  return database(storage)
    .select({
      id: agents.id,
      name: agents.name,
      palette: agents.lookPalette,
      seed: agents.lookSeed,
      lastRanAt: max(runs.startedAt),
      deactivatedAt: agents.deactivatedAt,
    })
    .from(agents)
    .leftJoin(runs, eq(runs.agentId, agents.id))
    .groupBy(agents.id)
    .orderBy(asc(agents.createdAt), asc(agents.id))
    .all()
    .map(({ palette, seed, deactivatedAt, ...agent }) => ({
      ...agent,
      look: { palette, seed },
      active: deactivatedAt === null,
    }));
}

/** Why a run ended by deactivating its agent didn't reply. */
export const DEACTIVATED_ERROR = "The agent was deactivated before this run ended.";

/** Why a run answering in a consult ended when the agent that asked was deactivated. */
export const ASKER_DEACTIVATED_ERROR =
  "The agent that asked was deactivated before this run ended.";

/**
 * Deactivates the agent and ends its runs that haven't ended, so no run in their threads waits on
 * them, and the unended runs answering in the consults those runs asked in, whose answers no one
 * would read. Returns the IDs of the runs it ended; undefined when the user has no such agent. An
 * agent already deactivated keeps the time it was first deactivated.
 */
export function deactivateAgent(
  storage: DurableObjectStorage,
  agentId: string,
  at: Date,
): string[] | undefined {
  return database(storage).transaction((tx) => {
    const agent = tx
      .select({ deactivatedAt: agents.deactivatedAt })
      .from(agents)
      .where(eq(agents.id, agentId))
      .get();
    if (agent === undefined) {
      return undefined;
    }
    if (agent.deactivatedAt === null) {
      tx.update(agents).set({ deactivatedAt: at }).where(eq(agents.id, agentId)).run();
    }
    const own = tx
      .update(runs)
      .set({ endedAt: at, lastError: DEACTIVATED_ERROR })
      .where(and(eq(runs.agentId, agentId), isNull(runs.endedAt)))
      .returning({ id: runs.id })
      .all()
      .map((row) => row.id);
    if (own.length === 0) {
      return own;
    }
    const consults = tx
      .select({ id: threads.id })
      .from(threads)
      .where(inArray(threads.consultRunId, own));
    const answering = tx
      .update(runs)
      .set({ endedAt: at, lastError: ASKER_DEACTIVATED_ERROR })
      .where(and(inArray(runs.threadId, consults), isNull(runs.endedAt)))
      .returning({ id: runs.id })
      .all()
      .map((row) => row.id);
    return [...own, ...answering];
  });
}

/**
 * Activates the agent again and moves each of its tasks to `nextRunAt` of it, so the times missed
 * while it was deactivated don't run. Says whether the user has the agent.
 */
export function activateAgent(
  storage: DurableObjectStorage,
  agentId: string,
  nextRunAt: (task: Task) => Date,
): boolean {
  return database(storage).transaction((tx) => {
    const agent = tx
      .select({ deactivatedAt: agents.deactivatedAt })
      .from(agents)
      .where(eq(agents.id, agentId))
      .get();
    if (agent === undefined) {
      return false;
    }
    if (agent.deactivatedAt === null) {
      return true;
    }
    tx.update(agents).set({ deactivatedAt: null }).where(eq(agents.id, agentId)).run();
    for (const row of tx.select().from(tasks).where(eq(tasks.agentId, agentId)).all()) {
      tx.update(tasks)
        .set({ nextRunAt: nextRunAt(toTask(row)) })
        .where(eq(tasks.id, row.id))
        .run();
    }
    return true;
  });
}

export function hasAgent(storage: DurableObjectStorage, id: string): boolean {
  const row = database(storage)
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, id))
    .get();
  return row !== undefined;
}

function toTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    agentId: row.agentId,
    threadId: row.threadId,
    prompt: row.prompt,
    schedule: { cron: row.cron, timeZone: row.timeZone },
    nextRunAt: row.nextRunAt,
  };
}

export function insertTask(storage: DurableObjectStorage, task: Task): void {
  database(storage)
    .insert(tasks)
    .values({
      id: task.id,
      agentId: task.agentId,
      threadId: task.threadId,
      prompt: task.prompt,
      cron: task.schedule.cron,
      timeZone: task.schedule.timeZone,
      nextRunAt: task.nextRunAt,
    })
    .run();
}

/** Deletes the agent's task and says whether it had one. Runs it already started stay. */
export function deleteTask(storage: DurableObjectStorage, agentId: string, id: string): boolean {
  const deleted = database(storage)
    .delete(tasks)
    .where(and(eq(tasks.agentId, agentId), eq(tasks.id, id)))
    .returning({ id: tasks.id })
    .all();
  return deleted.length > 0;
}

/** The agent's tasks, the next to run first. */
export function listTasks(storage: DurableObjectStorage, agentId: string): Task[] {
  return database(storage)
    .select()
    .from(tasks)
    .where(eq(tasks.agentId, agentId))
    .orderBy(asc(tasks.nextRunAt), asc(tasks.id))
    .all()
    .map(toTask);
}

/** The task whose run time came first, among the active agents' tasks due by `now`. */
export function nextDueTask(storage: DurableObjectStorage, now: Date): Task | undefined {
  const row = database(storage)
    .select({ task: tasks })
    .from(tasks)
    .innerJoin(agents, eq(agents.id, tasks.agentId))
    .where(and(lte(tasks.nextRunAt, now), isNull(agents.deactivatedAt)))
    .orderBy(asc(tasks.nextRunAt), asc(tasks.id))
    .limit(1)
    .get();
  return row === undefined ? undefined : toTask(row.task);
}

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

/** What the user said in a thread. */
export interface Post {
  readonly id: string;
  readonly threadId: string;
  /** The agent that asked it in a consult; null when the user said it. */
  readonly agentId: string | null;
  /** The tool call a consult's question was asked in; null when the user said it. */
  readonly callId: string | null;
  readonly text: string;
  readonly createdAt: Date;
}

/**
 * Adds a post and starts a run of each of `agentIds` that replies to it, all due at once and
 * started when the post was made. Each run's first message is the post as the thread reads it
 * (`asRead`). Returns the runs' IDs in the order of `agentIds`.
 */
export function insertPost(
  storage: DurableObjectStorage,
  post: Post,
  agentIds: readonly string[],
): string[] {
  const opening = postAsRead(post, agentNamesById(storage));
  const runIds = agentIds.map(() => crypto.randomUUID());
  database(storage).transaction((tx) => {
    tx.insert(posts).values(post).run();
    for (const [index, agentId] of agentIds.entries()) {
      const runId = runIds[index] ?? "";
      tx.insert(runs)
        .values({
          id: runId,
          agentId,
          threadId: post.threadId,
          postId: post.id,
          startedAt: post.createdAt,
          dueAt: post.createdAt,
        })
        .run();
      tx.insert(messages)
        .values(messageRow(runId, 0, { role: "user", text: opening }))
        .run();
    }
  });
  return runIds;
}

/** A post as an agent reads it: the user's as it is, an agent's after the agent's name. */
function postAsRead(post: Post, agentNames: ReadonlyMap<string, string>): string {
  return post.agentId === null ? post.text : `${agentNames.get(post.agentId) ?? ""}: ${post.text}`;
}

function agentNamesById(storage: DurableObjectStorage): Map<string, string> {
  return new Map(listAgents(storage).map((agent) => [agent.id, agent.name]));
}

/**
 * Makes a consult: a thread in which the agent of `runId` asks `answerer`, with both as its
 * members, named after the agent asked.
 */
export function insertConsult(
  storage: DurableObjectStorage,
  consult: {
    id: string;
    runId: string;
    askerId: string;
    answerer: { id: string; name: string };
    createdAt: Date;
  },
): void {
  database(storage).transaction((tx) => {
    tx.insert(threads)
      .values({
        id: consult.id,
        name: consult.answerer.name,
        consultRunId: consult.runId,
        createdAt: consult.createdAt,
      })
      .run();
    tx.insert(threadMembers)
      .values([
        { threadId: consult.id, agentId: consult.askerId },
        { threadId: consult.id, agentId: consult.answerer.id },
      ])
      .run();
  });
}

/** The consult the agent of `runId` holds with `answererId`, if it has asked it before. */
export function findConsult(
  storage: DurableObjectStorage,
  runId: string,
  answererId: string,
): string | undefined {
  return database(storage)
    .select({ id: threads.id })
    .from(threads)
    .innerJoin(threadMembers, eq(threadMembers.threadId, threads.id))
    .where(and(eq(threads.consultRunId, runId), eq(threadMembers.agentId, answererId)))
    .get()?.id;
}

/**
 * The question the run asked in the tool call, and the run that answers it, if the call asked
 * already. Calls are told apart within the run only: models may number them the same in each.
 */
export function consultAsked(
  storage: DurableObjectStorage,
  runId: string,
  callId: string,
): { postId: string; runId: string } | undefined {
  return database(storage)
    .select({ postId: posts.id, runId: runs.id })
    .from(posts)
    .innerJoin(runs, eq(runs.postId, posts.id))
    .innerJoin(threads, eq(threads.id, posts.threadId))
    .where(and(eq(posts.callId, callId), eq(threads.consultRunId, runId)))
    .get();
}

/**
 * How a run that answers stands: still going, ended with its reply's text, or ended without one
 * (given up, or stopped at its step limit) with why.
 */
export function answerOf(
  storage: DurableObjectStorage,
  runId: string,
): { done: false } | { done: true; reply: string } | { done: true; failure: string } {
  const row = database(storage)
    .select({ endedAt: runs.endedAt, lastError: runs.lastError })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();
  if (row === undefined) {
    return { done: true, failure: "The run that answers is gone." };
  }
  if (row.endedAt === null) {
    return { done: false };
  }
  const conversation = loadConversation(storage, runId);
  return nextAction(conversation).type === "done"
    ? { done: true, reply: replyText(conversation) }
    : { done: true, failure: row.lastError ?? "It stopped before it answered." };
}

export function findPost(storage: DurableObjectStorage, id: string): Post | undefined {
  return database(storage).select().from(posts).where(eq(posts.id, id)).get();
}

function messageRow(runId: string, seq: number, message: Message): typeof messages.$inferInsert {
  return { runId, seq, format: MESSAGE_FORMAT, body: JSON.stringify(message) };
}

export function appendMessage(
  storage: DurableObjectStorage,
  runId: string,
  seq: number,
  message: Message,
): void {
  database(storage)
    .insert(messages)
    .values(messageRow(runId, seq, message))
    .run();
}

export function loadConversation(storage: DurableObjectStorage, runId: string): Message[] {
  return database(storage)
    .select()
    .from(messages)
    .where(eq(messages.runId, runId))
    .orderBy(asc(messages.seq))
    .all()
    .map((row) => {
      if (row.format !== MESSAGE_FORMAT) {
        throw new Error(
          `Message ${row.seq} of run ${runId} is stored in format ${row.format}; this code reads only ${MESSAGE_FORMAT}.`,
        );
      }
      return messageSchema.parse(JSON.parse(row.body));
    });
}

const earlierRuns = alias(runs, "earlier_runs");

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
  readonly messages: Message[];
  /** The consults its agent asked in, by the tool call that asked. */
  readonly consults: readonly { readonly callId: string; readonly thread: Thread }[];
}

function toRun(storage: DurableObjectStorage, row: typeof runs.$inferSelect): Run {
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
  const entries: ({ at: Date } & ({ post: Post; replies: EarlierRun[] } | { run: EarlierRun }))[] =
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
      .all()
      .map((post) => ({
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
      yield [{ role: "user", text: postAsRead(entry.post, agentNames) }, ...replies];
    }
  }
}

/**
 * A message of an earlier run as a later run reads it. The model's reasoning stays with the run
 * that produced it: it was written against that run's view of the thread, not the later one's.
 */
function withoutReasoning(message: Message): Message {
  return message.role === "assistant"
    ? { ...message, parts: message.parts.filter((part) => part.type !== "reasoning") }
    : message;
}

/** The text of a finished conversation's last message. */
function replyText(conversation: readonly Message[]): string {
  const last = conversation.at(-1);
  return last?.role === "assistant"
    ? last.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
    : "";
}

/**
 * The latest `limit` posts and runs of the thread together, the latest first. A post comes before
 * the runs that reply to it.
 */
export function threadEntries(
  storage: DurableObjectStorage,
  threadId: string,
  limit: number,
): (
  | { readonly type: "post"; readonly post: Post }
  | { readonly type: "run"; readonly run: Run }
)[] {
  const db = database(storage);
  const latestPosts = db
    .select()
    .from(posts)
    .where(eq(posts.threadId, threadId))
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit)
    .all()
    .map((post) => ({ type: "post" as const, post, at: post.createdAt.getTime(), order: 0 }));
  const latestRuns = db
    .select()
    .from(runs)
    .where(eq(runs.threadId, threadId))
    .orderBy(desc(runs.startedAt), desc(runs.id))
    .limit(limit)
    .all()
    .map((row) => ({
      type: "run" as const,
      run: toRun(storage, row),
      at: row.startedAt.getTime(),
      order: 1,
    }));
  return [...latestPosts, ...latestRuns]
    .toSorted((a, b) => b.at - a.at || b.order - a.order)
    .slice(0, limit)
    .map((entry) =>
      entry.type === "post" ? { type: "post", post: entry.post } : { type: "run", run: entry.run },
    );
}

/** Which of `agentIds` are the user's agents. */
export function knownAgents(storage: DurableObjectStorage, agentIds: readonly string[]): string[] {
  if (agentIds.length === 0) {
    return [];
  }
  return database(storage)
    .select({ id: agents.id })
    .from(agents)
    .where(inArray(agents.id, [...agentIds]))
    .all()
    .map((row) => row.id);
}

/** The earliest next run time among the active agents' tasks. */
export function earliestTaskRunAt(storage: DurableObjectStorage): Date | undefined {
  const row = database(storage)
    .select({ next: min(tasks.nextRunAt) })
    .from(tasks)
    .innerJoin(agents, eq(agents.id, tasks.agentId))
    .where(isNull(agents.deactivatedAt))
    .get();
  return row?.next ?? undefined;
}

/** Counts one web search in `month` ("2026-11") and gives the month's count with it. */
export function countSearch(storage: DurableObjectStorage, month: string): number {
  const row = database(storage)
    .insert(searchCounts)
    .values({ month, count: 1 })
    .onConflictDoUpdate({
      target: searchCounts.month,
      set: { count: sql`${searchCounts.count} + 1` },
    })
    .returning({ count: searchCounts.count })
    .get();
  return row?.count ?? 1;
}

/**
 * What a run's system prompt needs: its agent's name, and its thread's one-to-one agent, group
 * name, and the name of the agent that asked in it when it is a consult. Undefined when there is
 * no such run.
 */
export function runSetting(
  storage: DurableObjectStorage,
  runId: string,
):
  | {
      agentName: string | null;
      startedAt: Date;
      thread: {
        id: string;
        agentId: string | null;
        name: string | null;
        askerName: string | null;
      };
    }
  | undefined {
  const asking = alias(runs, "asking");
  const asker = alias(agents, "asker");
  const row = database(storage)
    .select({
      agentName: agents.name,
      startedAt: runs.startedAt,
      threadId: runs.threadId,
      threadAgentId: threads.agentId,
      threadName: threads.name,
      consultRunId: threads.consultRunId,
      askerName: asker.name,
    })
    .from(runs)
    .leftJoin(agents, eq(agents.id, runs.agentId))
    .leftJoin(threads, eq(threads.id, runs.threadId))
    .leftJoin(asking, eq(asking.id, threads.consultRunId))
    .leftJoin(asker, eq(asker.id, asking.agentId))
    .where(eq(runs.id, runId))
    .get();
  if (row === undefined) {
    return undefined;
  }
  return {
    agentName: row.agentName,
    startedAt: row.startedAt,
    thread: {
      id: row.threadId,
      agentId: row.threadAgentId,
      name: row.threadName,
      askerName: row.consultRunId === null ? null : (row.askerName ?? "another agent"),
    },
  };
}

/** The time zone the user's days are read in. */
export function userTimeZone(storage: DurableObjectStorage): string {
  const row = database(storage).select({ timeZone: settings.timeZone }).from(settings).get();
  return row?.timeZone ?? DEFAULT_TIME_ZONE;
}

export function setTimeZone(storage: DurableObjectStorage, timeZone: string): void {
  database(storage)
    .insert(settings)
    .values({ id: 1, timeZone })
    .onConflictDoUpdate({ target: settings.id, set: { timeZone } })
    .run();
}

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
 * its prompt followed by its reply. Tool calls, their results, and the model's reasoning are left
 * out.
 */
export function saidBetween(
  storage: DurableObjectStorage,
  threadId: string,
  startsAt: Date,
  endsAt: Date,
): SaidLine[] {
  const db = database(storage);
  const names = agentNamesById(storage);
  const replyOf = (runId: string): string | undefined => {
    const conversation = loadConversation(storage, runId);
    return conversation.length > 0 && nextAction(conversation).type === "done"
      ? replyText(conversation)
      : undefined;
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
      .flatMap((run) => {
        const text = run.endedAt === null ? undefined : replyOf(run.id);
        return text === undefined || run.endedAt === null
          ? []
          : [{ at: run.endedAt, speaker: names.get(run.agentId) ?? "", text }];
      });
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
    const reply = run.endedAt === null ? undefined : replyOf(run.id);
    said.push({
      at: run.startedAt,
      lines: [
        {
          at: run.startedAt,
          speaker: `Task for ${name}`,
          text: prompt?.role === "user" ? prompt.text : "",
        },
        ...(reply === undefined || run.endedAt === null
          ? []
          : [{ at: run.endedAt, speaker: name, text: reply }]),
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

/** Keeps a mail the user forwarded. */
export function insertMail(storage: DurableObjectStorage, mail: Mail): void {
  database(storage)
    .insert(mails)
    .values({
      id: mail.id,
      fromAddress: mail.from.address,
      fromName: mail.from.name,
      subject: mail.subject,
      text: mail.text,
      attachmentNames: [...mail.attachmentNames],
      receivedAt: mail.receivedAt,
    })
    .run();
}

/** Removes the mail that arrived before `cutoff`. */
export function deleteMailBefore(storage: DurableObjectStorage, cutoff: Date): void {
  database(storage).delete(mails).where(lt(mails.receivedAt, cutoff)).run();
}

/**
 * The mail that arrived from `after` up to before `before`, the latest first, at most `limit` of
 * it, with how many more there are.
 */
export function listMail(
  storage: DurableObjectStorage,
  range: { after: Date; before: Date | undefined },
  limit: number,
): { mail: Mail[]; more: number } {
  const where = and(
    gte(mails.receivedAt, range.after),
    range.before === undefined ? undefined : lt(mails.receivedAt, range.before),
  );
  const db = database(storage);
  const rows = db
    .select()
    .from(mails)
    .where(where)
    .orderBy(desc(mails.receivedAt), desc(mails.id))
    .limit(limit)
    .all();
  const total = db.select({ n: count() }).from(mails).where(where).get()?.n ?? 0;
  return { mail: rows.map(toMail), more: Math.max(0, total - rows.length) };
}

/** A kept mail by ID that arrived from `after`, if there is one. */
export function findMail(storage: DurableObjectStorage, id: string, after: Date): Mail | undefined {
  const row = database(storage)
    .select()
    .from(mails)
    .where(and(eq(mails.id, id), gte(mails.receivedAt, after)))
    .get();
  return row === undefined ? undefined : toMail(row);
}

function toMail(row: typeof mails.$inferSelect): Mail {
  return {
    id: row.id,
    from: { address: row.fromAddress, name: row.fromName },
    subject: row.subject,
    text: row.text,
    attachmentNames: row.attachmentNames,
    receivedAt: row.receivedAt,
  };
}

/** Where the user's mail setup stands. */
export function mailState(storage: DurableObjectStorage): MailState {
  const row = database(storage).select().from(mailSetup).get();
  return {
    confirmation:
      row?.confirmationUrl == null || row.confirmationAt === null
        ? null
        : { url: row.confirmationUrl, code: row.confirmationCode, receivedAt: row.confirmationAt },
    lastMailAt: row?.lastMailAt ?? null,
  };
}

/** Keeps the Gmail forwarding confirmation that arrived, in place of any before it. */
export function setMailConfirmation(
  storage: DurableObjectStorage,
  confirmation: MailConfirmation,
): void {
  const values = {
    confirmationUrl: confirmation.url,
    confirmationCode: confirmation.code,
    confirmationAt: confirmation.receivedAt,
  };
  database(storage)
    .insert(mailSetup)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: mailSetup.id, set: values })
    .run();
}

/** Records that mail arrived at `at`: forwarding works, so the confirmation is done with. */
export function recordMailArrived(storage: DurableObjectStorage, at: Date): void {
  const values = {
    confirmationUrl: null,
    confirmationCode: null,
    confirmationAt: null,
    lastMailAt: at,
  };
  database(storage)
    .insert(mailSetup)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: mailSetup.id, set: values })
    .run();
}

/** Lets go of the Gmail forwarding confirmation, keeping when mail last arrived. */
export function clearMailConfirmation(storage: DurableObjectStorage): void {
  database(storage)
    .update(mailSetup)
    .set({ confirmationUrl: null, confirmationCode: null, confirmationAt: null })
    .run();
}

/** Starts the mail setup over, as for a new address or none. */
export function resetMailSetup(storage: DurableObjectStorage): void {
  database(storage).delete(mailSetup).run();
}

/** Removes all kept mail. */
export function deleteAllMail(storage: DurableObjectStorage): void {
  database(storage).delete(mails).run();
}
