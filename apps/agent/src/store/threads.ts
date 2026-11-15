import { asc, desc, eq, inArray, isNull, max, type SQL } from "drizzle-orm";
import { agents, posts, runs, threadMembers, threads } from "../db/schema";
import { agentNamesById } from "./agents";
import { withAttachments } from "./attachments";
import { database } from "./database";
import { type PostWithAttachments } from "./posts";
import { type Run, toRun } from "./runs";

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
export function readThreads(storage: DurableObjectStorage, where: SQL | undefined): Thread[] {
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

/**
 * The latest `limit` posts and runs of the thread together, the latest first. A post comes before
 * the runs that reply to it.
 */
export function threadEntries(
  storage: DurableObjectStorage,
  threadId: string,
  limit: number,
): (
  | { readonly type: "post"; readonly post: PostWithAttachments }
  | { readonly type: "run"; readonly run: Run }
)[] {
  const db = database(storage);
  const latestPosts = withAttachments(
    storage,
    db
      .select()
      .from(posts)
      .where(eq(posts.threadId, threadId))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(limit)
      .all(),
  ).map((post) => ({ type: "post" as const, post, at: post.createdAt.getTime(), order: 0 }));
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
