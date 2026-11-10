import { type Message, messageSchema } from "@iris/agent";
import { and, asc, desc, eq, isNull, lt, lte, max, min, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import migrations from "../drizzle/migrations";
import { agents, messages, runs, tasks } from "./db/schema";
import type { Schedule } from "./schedule";

/** The format messages are stored in. A stored message in any other format is refused, not guessed at. */
const MESSAGE_FORMAT = 1;

function database(storage: DurableObjectStorage) {
  return drizzle(storage);
}

/** One of the user's agents, with when its latest run started (null until it first runs). */
export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly lastRanAt: Date | null;
}

export interface Task {
  readonly id: string;
  readonly agentId: string;
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

export function insertAgent(
  storage: DurableObjectStorage,
  agent: { id: string; name: string; createdAt: Date },
): void {
  database(storage).insert(agents).values(agent).run();
}

/** The user's agents in the order they were added. */
export function listAgents(storage: DurableObjectStorage): Agent[] {
  return database(storage)
    .select({ id: agents.id, name: agents.name, lastRanAt: max(runs.startedAt) })
    .from(agents)
    .leftJoin(runs, eq(runs.agentId, agents.id))
    .groupBy(agents.id)
    .orderBy(asc(agents.createdAt), asc(agents.id))
    .all();
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
 * the same time. A run without a task is one a message the user sent started.
 */
export function startRun(
  storage: DurableObjectStorage,
  run: {
    id: string;
    agentId: string;
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

/** The ID of the run that hasn't ended whose due time came first, among every agent's runs due by `now`. */
export function nextDueRun(storage: DurableObjectStorage, now: Date): string | undefined {
  const row = database(storage)
    .select({ id: runs.id })
    .from(runs)
    .where(and(isNull(runs.endedAt), lte(runs.dueAt, now)))
    .orderBy(asc(runs.dueAt), asc(runs.id))
    .limit(1)
    .get();
  return row?.id;
}

/** When the earliest run that hasn't ended is due. */
export function earliestRunDueAt(storage: DurableObjectStorage): Date | undefined {
  const row = database(storage)
    .select({ next: min(runs.dueAt) })
    .from(runs)
    .where(isNull(runs.endedAt))
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
  readonly taskId: string | null;
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
    taskId: row.taskId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    lastError: row.lastError,
    failedAttempts: row.failedAttempts,
    messages: loadConversation(storage, row.id),
  };
}

export function findRun(storage: DurableObjectStorage, id: string): Run | undefined {
  const row = database(storage).select().from(runs).where(eq(runs.id, id)).get();
  return row === undefined ? undefined : toRun(storage, row);
}

/** The agent's latest runs first, each with its conversation. */
export function recentRuns(storage: DurableObjectStorage, agentId: string, limit: number): Run[] {
  return database(storage)
    .select()
    .from(runs)
    .where(eq(runs.agentId, agentId))
    .orderBy(desc(runs.startedAt), asc(runs.id))
    .limit(limit)
    .all()
    .map((row) => toRun(storage, row));
}

/**
 * The conversations of the runs of the same agent that started before the run, the latest first.
 * Each is read from storage only when the caller asks for it.
 */
export function* earlierConversations(
  storage: DurableObjectStorage,
  runId: string,
): Generator<Message[], void, undefined> {
  const run = database(storage)
    .select({ agentId: runs.agentId, startedAt: runs.startedAt })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();
  if (run === undefined) {
    throw new Error(`There is no run ${runId} to read the earlier runs of.`);
  }
  const earlier = database(storage)
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.agentId, run.agentId),
        or(
          lt(runs.startedAt, run.startedAt),
          and(eq(runs.startedAt, run.startedAt), lt(runs.id, runId)),
        ),
      ),
    )
    .orderBy(desc(runs.startedAt), desc(runs.id))
    .all();
  for (const { id } of earlier) {
    yield loadConversation(storage, id);
  }
}

export function earliestTaskRunAt(storage: DurableObjectStorage): Date | undefined {
  const row = database(storage)
    .select({ next: min(tasks.nextRunAt) })
    .from(tasks)
    .get();
  return row?.next ?? undefined;
}
