import { eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { agents, runs, searchCounts, settings, threads } from "../db/schema";
import { DEFAULT_TIME_ZONE } from "../day";
import { database } from "./database";

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
