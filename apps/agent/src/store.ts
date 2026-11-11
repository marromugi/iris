import { type Message, messageSchema, nextAction } from "@iris/agent";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  max,
  min,
  notExists,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { alias } from "drizzle-orm/sqlite-core";
import migrations from "../drizzle/migrations";
import { agents, messages, posts, runs, tasks, threadMembers, threads } from "./db/schema";
import type { Look } from "./agent";
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
 * A thread as the home lists it: a group with its name, or an agent's one-to-one thread with the
 * agent's name and ID. `lastActivityAt` is when it was made, a post was sent, or a run started,
 * whichever came last.
 */
export interface Thread {
  readonly id: string;
  readonly name: string;
  /** The agent whose one-to-one thread this is; null for a group. */
  readonly agentId: string | null;
  /** The members in the order they were added as agents. */
  readonly agentIds: readonly string[];
  readonly lastActivityAt: Date;
}

/** The user's threads, the latest activity first. */
export function listThreads(storage: DurableObjectStorage): Thread[] {
  const db = database(storage);
  const lastPostAt = new Map(
    db
      .select({ threadId: posts.threadId, at: max(posts.createdAt) })
      .from(posts)
      .groupBy(posts.threadId)
      .all()
      .map((row) => [row.threadId, row.at]),
  );
  const lastRunAt = new Map(
    db
      .select({ threadId: runs.threadId, at: max(runs.startedAt) })
      .from(runs)
      .groupBy(runs.threadId)
      .all()
      .map((row) => [row.threadId, row.at]),
  );
  const members = threadMembersById(storage);
  const agentNames = new Map(listAgents(storage).map((agent) => [agent.id, agent.name]));
  return db
    .select()
    .from(threads)
    .all()
    .map((row): Thread => {
      const times = [row.createdAt, lastPostAt.get(row.id), lastRunAt.get(row.id)]
        .filter((time) => time !== undefined && time !== null)
        .map((time) => time.getTime());
      return {
        id: row.id,
        name: row.name ?? agentNames.get(row.agentId ?? "") ?? "",
        agentId: row.agentId,
        agentIds: members.get(row.id) ?? [],
        lastActivityAt: new Date(Math.max(...times)),
      };
    })
    .toSorted(
      (a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime() || a.id.localeCompare(b.id),
    );
}

/** One of the user's threads by its ID. */
export function findThread(storage: DurableObjectStorage, id: string): Thread | undefined {
  return listThreads(storage).find((thread) => thread.id === id);
}

/** Each thread's member IDs, in the order the agents were added. */
function threadMembersById(storage: DurableObjectStorage): Map<string, string[]> {
  const byThread = new Map<string, string[]>();
  for (const row of database(storage)
    .select({ threadId: threadMembers.threadId, agentId: threadMembers.agentId })
    .from(threadMembers)
    .innerJoin(agents, eq(agents.id, threadMembers.agentId))
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
    })
    .from(agents)
    .leftJoin(runs, eq(runs.agentId, agents.id))
    .groupBy(agents.id)
    .orderBy(asc(agents.createdAt), asc(agents.id))
    .all()
    .map(({ palette, seed, ...agent }) => ({ ...agent, look: { palette, seed } }));
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

/** The task whose run time came first, among every agent's tasks due by `now`. */
export function nextDueTask(storage: DurableObjectStorage, now: Date): Task | undefined {
  const row = database(storage)
    .select()
    .from(tasks)
    .where(lte(tasks.nextRunAt, now))
    .orderBy(asc(tasks.nextRunAt), asc(tasks.id))
    .limit(1)
    .get();
  return row === undefined ? undefined : toTask(row);
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
  readonly text: string;
  readonly createdAt: Date;
}

/**
 * Adds a post and starts a run of each of `agentIds` that replies to it, all due at once and
 * started when the post was made. Each run's first message is the post's text. Returns the runs'
 * IDs in the order of `agentIds`.
 */
export function insertPost(
  storage: DurableObjectStorage,
  post: Post,
  agentIds: readonly string[],
): string[] {
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
        .values(messageRow(runId, 0, { role: "user", text: post.text }))
        .run();
    }
  });
  return runIds;
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

/** The IDs of up to `limit` runs next in line that are due by `now`, the earliest due first. */
export function nextDueRuns(storage: DurableObjectStorage, now: Date, limit: number): string[] {
  return database(storage)
    .select({ id: runs.id })
    .from(runs)
    .where(and(nextInLine(storage), lte(runs.dueAt, now)))
    .orderBy(asc(runs.dueAt), asc(runs.id))
    .limit(limit)
    .all()
    .map((row) => row.id);
}

/** When the earliest run next in line is due. */
export function earliestRunDueAt(storage: DurableObjectStorage): Date | undefined {
  const row = database(storage)
    .select({ next: min(runs.dueAt) })
    .from(runs)
    .where(nextInLine(storage))
    .get();
  return row?.next ?? undefined;
}

/** Sets when the run is next due to be carried on. */
export function postponeRun(storage: DurableObjectStorage, runId: string, dueAt: Date): void {
  database(storage).update(runs).set({ dueAt }).where(eq(runs.id, runId)).run();
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
  };
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
 * conversation (without the post, which comes first); another agent's is its reply as a user
 * message after the agent's name. A post without such a reply, and a run without one (given up,
 * or stopped at its step limit), are passed over. Only what came before the run started counts,
 * so replies to the same post don't read each other. Conversations are read from storage only
 * when the caller asks for their entry.
 */
export function* earlierInThread(
  storage: DurableObjectStorage,
  runId: string,
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
    .where(and(eq(runs.threadId, run.threadId), lt(runs.startedAt, run.startedAt)))
    .orderBy(asc(runs.endedAt), asc(runs.id))
    .all();
  type EarlierRun = (typeof earlierRunRows)[number];
  const entries: ({ at: Date } & ({ post: Post; replies: EarlierRun[] } | { run: EarlierRun }))[] =
    db
      .select()
      .from(posts)
      .where(and(eq(posts.threadId, run.threadId), lt(posts.createdAt, run.startedAt)))
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
    return row.postId === null ? conversation : conversation.slice(1);
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
      yield [{ role: "user", text: entry.post.text }, ...replies];
    }
  }
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

export function earliestTaskRunAt(storage: DurableObjectStorage): Date | undefined {
  const row = database(storage)
    .select({ next: min(tasks.nextRunAt) })
    .from(tasks)
    .get();
  return row?.next ?? undefined;
}
