import { and, asc, eq, isNull, lte, min } from "drizzle-orm";
import { agents, tasks } from "../db/schema";
import { type Schedule } from "../schedule";
import { database } from "./database";
import { noRunWaitsForAnswer } from "./runs";

export interface Task {
  readonly id: string;
  readonly agentId: string;
  /** The thread its runs happen in. */
  readonly threadId: string;
  readonly prompt: string;
  readonly schedule: Schedule;
  readonly nextRunAt: Date;
}

export function toTask(row: typeof tasks.$inferSelect): Task {
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
    .where(
      and(lte(tasks.nextRunAt, now), isNull(agents.deactivatedAt), noRunWaitsForAnswer(storage)),
    )
    .orderBy(asc(tasks.nextRunAt), asc(tasks.id))
    .limit(1)
    .get();
  return row === undefined ? undefined : toTask(row.task);
}

/**
 * The earliest next run time among the active agents' tasks, leaving out those whose thread has a
 * run waiting for the user's answer.
 */
export function earliestTaskRunAt(storage: DurableObjectStorage): Date | undefined {
  const row = database(storage)
    .select({ next: min(tasks.nextRunAt) })
    .from(tasks)
    .innerJoin(agents, eq(agents.id, tasks.agentId))
    .where(and(isNull(agents.deactivatedAt), noRunWaitsForAnswer(storage)))
    .get();
  return row?.next ?? undefined;
}
