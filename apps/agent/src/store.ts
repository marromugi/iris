import { type Message, messageSchema } from "@iris/agent";
import { asc, desc, eq, isNull, lte, min, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import migrations from "../drizzle/migrations";
import { messages, runs, tasks } from "./db/schema";
import type { Schedule } from "./schedule";

/** The format messages are stored in. A stored message in any other format is refused, not guessed at. */
const MESSAGE_FORMAT = 1;

function database(storage: DurableObjectStorage) {
  return drizzle(storage);
}

export interface Task {
  readonly id: string;
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

function toTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
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
      prompt: task.prompt,
      cron: task.schedule.cron,
      timeZone: task.schedule.timeZone,
      nextRunAt: task.nextRunAt,
    })
    .run();
}

/** Deletes the task and says whether there was one. Runs it already started stay. */
export function deleteTask(storage: DurableObjectStorage, id: string): boolean {
  return (
    database(storage).delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id }).all()
      .length > 0
  );
}

export function listTasks(storage: DurableObjectStorage): Task[] {
  return database(storage)
    .select()
    .from(tasks)
    .orderBy(asc(tasks.nextRunAt), asc(tasks.id))
    .all()
    .map(toTask);
}

/** The task whose run time came first, among those due by `now`. */
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
 * Starts a run of the task with its prompt as the first message, and moves the task to its next
 * run time, in one transaction: a task is never started twice for the same time.
 */
export function startRun(
  storage: DurableObjectStorage,
  run: { id: string; task: Task; startedAt: Date; taskNextRunAt: Date },
): void {
  database(storage).transaction((tx) => {
    tx.update(tasks).set({ nextRunAt: run.taskNextRunAt }).where(eq(tasks.id, run.task.id)).run();
    tx.insert(runs).values({ id: run.id, taskId: run.task.id, startedAt: run.startedAt }).run();
    tx.insert(messages)
      .values(messageRow(run.id, 0, { role: "user", text: run.task.prompt }))
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

export interface UnendedRun {
  readonly id: string;
  /** When the run last failed, or when it started if it never failed (it was cut off). */
  readonly lastTriedAt: Date;
}

export function unendedRuns(storage: DurableObjectStorage): UnendedRun[] {
  return database(storage)
    .select({ id: runs.id, startedAt: runs.startedAt, lastFailedAt: runs.lastFailedAt })
    .from(runs)
    .where(isNull(runs.endedAt))
    .orderBy(asc(runs.startedAt), asc(runs.id))
    .all()
    .map((row) => ({ id: row.id, lastTriedAt: row.lastFailedAt ?? row.startedAt }));
}

/** Ends a run that finished or reached its step limit, clearing any earlier failure. */
export function endRun(storage: DurableObjectStorage, runId: string, endedAt: Date): void {
  database(storage).update(runs).set({ endedAt, lastError: null }).where(eq(runs.id, runId)).run();
}

/** Ends a run that won't be tried again, keeping the error of its last attempt. */
export function giveUpRun(storage: DurableObjectStorage, runId: string, endedAt: Date): void {
  database(storage).update(runs).set({ endedAt }).where(eq(runs.id, runId)).run();
}

/** Records a failed attempt and returns how many attempts of the run have failed so far. */
export function recordRunFailure(
  storage: DurableObjectStorage,
  runId: string,
  failure: { error: string; failedAt: Date },
): number {
  const row = database(storage)
    .update(runs)
    .set({
      lastError: failure.error,
      lastFailedAt: failure.failedAt,
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

/** The latest runs first, each with its conversation. */
export function recentRuns(storage: DurableObjectStorage, limit: number): Run[] {
  return database(storage)
    .select()
    .from(runs)
    .orderBy(desc(runs.startedAt), asc(runs.id))
    .limit(limit)
    .all()
    .map((row) => ({
      id: row.id,
      taskId: row.taskId,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      lastError: row.lastError,
      failedAttempts: row.failedAttempts,
      messages: loadConversation(storage, row.id),
    }));
}

export function earliestTaskRunAt(storage: DurableObjectStorage): Date | undefined {
  const row = database(storage)
    .select({ next: min(tasks.nextRunAt) })
    .from(tasks)
    .get();
  return row?.next ?? undefined;
}
