import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import { attachments } from "../db/schema";
import { database } from "./database";
import { type Post, type PostWithAttachments } from "./posts";

/** An image put up to send with a post. */
export interface Attachment {
  readonly id: string;
  readonly mediaType: string;
  readonly size: number;
}

/** Keeps an image put up to send with a post, before any post takes it. */
export function insertAttachment(
  storage: DurableObjectStorage,
  attachment: Attachment & { readonly createdAt: Date },
): void {
  database(storage).insert(attachments).values(attachment).run();
}

export function findAttachment(storage: DurableObjectStorage, id: string): Attachment | undefined {
  return database(storage)
    .select({ id: attachments.id, mediaType: attachments.mediaType, size: attachments.size })
    .from(attachments)
    .where(eq(attachments.id, id))
    .get();
}

/** The images of `ids` that are kept and no post has taken yet, in the order of `ids`. */
export function unusedAttachments(
  storage: DurableObjectStorage,
  ids: readonly string[],
): Attachment[] {
  if (ids.length === 0) {
    return [];
  }
  const found = new Map(
    database(storage)
      .select({ id: attachments.id, mediaType: attachments.mediaType, size: attachments.size })
      .from(attachments)
      .where(and(inArray(attachments.id, [...ids]), isNull(attachments.postId)))
      .all()
      .map((attachment) => [attachment.id, attachment]),
  );
  return ids.flatMap((id) => {
    const attachment = found.get(id);
    return attachment === undefined ? [] : [attachment];
  });
}

/** Removes the images no post took that were put up before `before`, and returns their IDs. */
export function removeUnusedAttachments(storage: DurableObjectStorage, before: Date): string[] {
  return database(storage)
    .delete(attachments)
    .where(and(isNull(attachments.postId), lt(attachments.createdAt, before)))
    .returning({ id: attachments.id })
    .all()
    .map((row) => row.id);
}

/** Each of `postList` with the images it was sent with. */
export function withAttachments(
  storage: DurableObjectStorage,
  postList: readonly Post[],
): PostWithAttachments[] {
  const ids = postList.map((post) => post.id);
  const rows =
    ids.length === 0
      ? []
      : database(storage)
          .select()
          .from(attachments)
          .where(inArray(attachments.postId, ids))
          .orderBy(asc(attachments.position))
          .all();
  return postList.map((post) => ({
    ...post,
    attachments: rows
      .filter((row) => row.postId === post.id)
      .map(({ id, mediaType, size }) => ({ id, mediaType, size })),
  }));
}
