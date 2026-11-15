import { nextAction } from "@iris/agent";
import { and, eq } from "drizzle-orm";
import { posts, runs, threadMembers, threads } from "../db/schema";
import { loadConversation, replyText } from "./conversation";
import { database } from "./database";

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
