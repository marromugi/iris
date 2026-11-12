import { z } from "zod";

/** The most images one post can carry. */
export const MAX_ATTACHMENTS_PER_POST = 4;

/**
 * What a user sends to an agent: the text the run it starts begins with, and the images put up
 * for it beforehand. The text may be empty only when there are images.
 */
export const newMessageSchema = z
  .object({
    text: z.string().trim(),
    attachmentIds: z
      .array(z.uuid())
      .max(MAX_ATTACHMENTS_PER_POST)
      .refine((ids) => new Set(ids).size === ids.length, "An image can be sent only once.")
      .default([]),
  })
  .refine((message) => message.text !== "" || message.attachmentIds.length > 0, {
    message: "A message needs text or an image.",
    path: ["text"],
  });

export type NewMessage = z.input<typeof newMessageSchema>;
