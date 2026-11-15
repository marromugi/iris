import { and, asc, eq, inArray, isNull, max } from "drizzle-orm";
import { agents, runs, tasks, threadMembers, threads } from "../db/schema";
import { type Look } from "../agent";
import { database } from "./database";
import { type Task, toTask } from "./tasks";

/** One of the user's agents, with its look and when its latest run started (null until it first runs). */
export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly look: Look;
  readonly lastRanAt: Date | null;
  /** False while the agent is deactivated: it starts no run of its own and replies to nothing. */
  readonly active: boolean;
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

export function agentNamesById(storage: DurableObjectStorage): Map<string, string> {
  return new Map(listAgents(storage).map((agent) => [agent.id, agent.name]));
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
