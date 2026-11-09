import { type Message, messageSchema } from "@iris/agent";
import type { Schedule } from "./schedule";

/** Each entry brings the schema from the version before it to its own; the index plus one is the version. */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE tasks (
     id TEXT PRIMARY KEY,
     prompt TEXT NOT NULL,
     cron TEXT NOT NULL,
     time_zone TEXT NOT NULL,
     next_run_at INTEGER NOT NULL
   );
   CREATE TABLE runs (
     id TEXT PRIMARY KEY,
     task_id TEXT,
     started_at INTEGER NOT NULL,
     ended_at INTEGER,
     last_error TEXT
   );
   CREATE TABLE messages (
     run_id TEXT NOT NULL,
     seq INTEGER NOT NULL,
     format INTEGER NOT NULL,
     body TEXT NOT NULL,
     PRIMARY KEY (run_id, seq)
   );`,
];

/** The format messages are stored in. A stored message in any other format is refused, not guessed at. */
const MESSAGE_FORMAT = 1;

export interface Task {
  readonly id: string;
  readonly prompt: string;
  readonly schedule: Schedule;
  readonly nextRunAt: Date;
}

/** Brings the schema up to the latest version. Refuses storage written by a newer version of this code. */
export function migrate(storage: DurableObjectStorage): void {
  storage.sql.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = storage.sql
    .exec<{ version: number }>("SELECT version FROM schema_version")
    .toArray()[0];
  const current = row?.version ?? 0;
  if (current > MIGRATIONS.length) {
    throw new Error(
      `Storage is at schema version ${current}, newer than the ${MIGRATIONS.length} this code knows.`,
    );
  }
  for (const [index, migration] of MIGRATIONS.entries()) {
    if (index < current) {
      continue;
    }
    storage.transactionSync(() => {
      storage.sql.exec(migration);
      storage.sql.exec("DELETE FROM schema_version");
      storage.sql.exec("INSERT INTO schema_version (version) VALUES (?)", index + 1);
    });
  }
}

type TaskRow = {
  id: string;
  prompt: string;
  cron: string;
  time_zone: string;
  next_run_at: number;
};

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    prompt: row.prompt,
    schedule: { cron: row.cron, timeZone: row.time_zone },
    nextRunAt: new Date(row.next_run_at),
  };
}

export function insertTask(storage: DurableObjectStorage, task: Task): void {
  storage.sql.exec(
    "INSERT INTO tasks (id, prompt, cron, time_zone, next_run_at) VALUES (?, ?, ?, ?, ?)",
    task.id,
    task.prompt,
    task.schedule.cron,
    task.schedule.timeZone,
    task.nextRunAt.getTime(),
  );
}

/** Deletes the task and says whether there was one. Runs it already started stay. */
export function deleteTask(storage: DurableObjectStorage, id: string): boolean {
  return storage.sql.exec("DELETE FROM tasks WHERE id = ?", id).rowsWritten > 0;
}

export function listTasks(storage: DurableObjectStorage): Task[] {
  return storage.sql
    .exec<TaskRow>("SELECT * FROM tasks ORDER BY next_run_at, id")
    .toArray()
    .map(toTask);
}

export function dueTasks(storage: DurableObjectStorage, now: Date): Task[] {
  return storage.sql
    .exec<TaskRow>(
      "SELECT * FROM tasks WHERE next_run_at <= ? ORDER BY next_run_at, id",
      now.getTime(),
    )
    .toArray()
    .map(toTask);
}

/**
 * Starts a run of the task with its prompt as the first message, and moves the task to its next
 * run time, in one transaction: a task is never started twice for the same time.
 */
export function startRun(
  storage: DurableObjectStorage,
  run: { id: string; task: Task; startedAt: Date; taskNextRunAt: Date },
): void {
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE tasks SET next_run_at = ? WHERE id = ?",
      run.taskNextRunAt.getTime(),
      run.task.id,
    );
    storage.sql.exec(
      "INSERT INTO runs (id, task_id, started_at) VALUES (?, ?, ?)",
      run.id,
      run.task.id,
      run.startedAt.getTime(),
    );
    appendMessage(storage, run.id, 0, { role: "user", text: run.task.prompt });
  });
}

export function appendMessage(
  storage: DurableObjectStorage,
  runId: string,
  seq: number,
  message: Message,
): void {
  storage.sql.exec(
    "INSERT INTO messages (run_id, seq, format, body) VALUES (?, ?, ?, ?)",
    runId,
    seq,
    MESSAGE_FORMAT,
    JSON.stringify(message),
  );
}

export function loadConversation(storage: DurableObjectStorage, runId: string): Message[] {
  return storage.sql
    .exec<{ seq: number; format: number; body: string }>(
      "SELECT seq, format, body FROM messages WHERE run_id = ? ORDER BY seq",
      runId,
    )
    .toArray()
    .map((row) => {
      if (row.format !== MESSAGE_FORMAT) {
        throw new Error(
          `Message ${row.seq} of run ${runId} is stored in format ${row.format}; this code reads only ${MESSAGE_FORMAT}.`,
        );
      }
      return messageSchema.parse(JSON.parse(row.body));
    });
}

export function unendedRunIds(storage: DurableObjectStorage): string[] {
  return storage.sql
    .exec<{ id: string }>("SELECT id FROM runs WHERE ended_at IS NULL ORDER BY started_at, id")
    .toArray()
    .map((row) => row.id);
}

export function endRun(storage: DurableObjectStorage, runId: string, endedAt: Date): void {
  storage.sql.exec(
    "UPDATE runs SET ended_at = ?, last_error = NULL WHERE id = ?",
    endedAt.getTime(),
    runId,
  );
}

export function recordRunError(storage: DurableObjectStorage, runId: string, error: string): void {
  storage.sql.exec("UPDATE runs SET last_error = ? WHERE id = ?", error, runId);
}

export interface Run {
  readonly id: string;
  readonly taskId: string | null;
  readonly startedAt: Date;
  /** Set once the run has finished or reached its step limit; unset while it still has to be carried on. */
  readonly endedAt: Date | null;
  /** Why the last attempt failed, while the run is waiting to be carried on. */
  readonly lastError: string | null;
  readonly messages: Message[];
}

/** The latest runs first, each with its conversation. */
export function recentRuns(storage: DurableObjectStorage, limit: number): Run[] {
  return storage.sql
    .exec<{
      id: string;
      task_id: string | null;
      started_at: number;
      ended_at: number | null;
      last_error: string | null;
    }>("SELECT * FROM runs ORDER BY started_at DESC, id LIMIT ?", limit)
    .toArray()
    .map((row) => ({
      id: row.id,
      taskId: row.task_id,
      startedAt: new Date(row.started_at),
      endedAt: row.ended_at === null ? null : new Date(row.ended_at),
      lastError: row.last_error,
      messages: loadConversation(storage, row.id),
    }));
}

export function earliestTaskRunAt(storage: DurableObjectStorage): Date | undefined {
  const row = storage.sql
    .exec<{ next: number | null }>("SELECT min(next_run_at) AS next FROM tasks")
    .one();
  return row.next === null ? undefined : new Date(row.next);
}
