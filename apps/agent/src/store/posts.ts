import { type UserMessage } from "@iris/agent";
import { and, eq, isNull } from "drizzle-orm";
import { attachments, messages, posts, runs } from "../db/schema";
import { agentNamesById } from "./agents";
import { type Attachment } from "./attachments";
import { messageRow } from "./conversation";
import { database } from "./database";

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

/** A post with the images it was sent with, in the order they were sent. */
export interface PostWithAttachments extends Post {
  readonly attachments: readonly Attachment[];
}

/**
 * Adds a post and starts a run of each of `agentIds` that replies to it, all due at once and
 * started when the post was made. Each run's first message is the post as the thread reads it
 * (`asRead`). The post takes `attachmentIds`, which must be unused (`unusedAttachments`). Returns
 * the runs' IDs in the order of `agentIds`.
 */
export function insertPost(
  storage: DurableObjectStorage,
  post: Post,
  agentIds: readonly string[],
  attachmentIds: readonly string[] = [],
): string[] {
  const opening = postAsRead(post, attachmentIds, agentNamesById(storage));
  const runIds = agentIds.map(() => crypto.randomUUID());
  database(storage).transaction((tx) => {
    tx.insert(posts).values(post).run();
    for (const [index, id] of attachmentIds.entries()) {
      tx.update(attachments)
        .set({ postId: post.id, position: index })
        .where(and(eq(attachments.id, id), isNull(attachments.postId)))
        .run();
    }
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
        .values(messageRow(runId, 0, opening))
        .run();
    }
  });
  return runIds;
}

/**
 * A post as an agent reads it: the user's text as it is, an agent's after the agent's name, with
 * the images it was sent with (`attachmentIds`, in order) as references.
 */
export function postAsRead(
  post: Post,
  attachmentIds: readonly string[],
  agentNames: ReadonlyMap<string, string>,
): UserMessage {
  const text =
    post.agentId === null ? post.text : `${agentNames.get(post.agentId) ?? ""}: ${post.text}`;
  return attachmentIds.length === 0
    ? { role: "user", text }
    : { role: "user", text, images: attachmentIds.map((id) => ({ type: "image", id })) };
}

export function findPost(storage: DurableObjectStorage, id: string): Post | undefined {
  return database(storage).select().from(posts).where(eq(posts.id, id)).get();
}
