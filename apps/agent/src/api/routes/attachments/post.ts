import { createRoute, defineOpenAPIRoute, z } from "@hono/zod-openapi";
import {
  ATTACHMENT_MEDIA_TYPES,
  attachmentKey,
  isAttachmentMediaType,
  looksLike,
  MAX_ATTACHMENT_BYTES,
} from "../../../attachment";
import { canAttachImages } from "../../../model-provider";
import type { Answer } from "../../answer";
import { errorResponse, signedIn } from "../../errors";
import type { ApiEnv } from "../../middlewares/signed-in-user";
import { attachmentSchema, json } from "../../schemas";

export const NO_IMAGES = "The model the agents think with doesn't read images.";

const imageBody = z.string().meta({ format: "binary" });

const route = createRoute({
  operationId: "putUpAttachment",
  method: "post",
  path: "/api/attachments",
  request: {
    body: {
      content: Object.fromEntries(
        ATTACHMENT_MEDIA_TYPES.map((type) => [type, { schema: imageBody }]),
      ),
      required: true,
      description: `The image's bytes, at most ${MAX_ATTACHMENT_BYTES} of them`,
    },
  },
  responses: {
    201: json(
      attachmentSchema,
      "The image as kept. Send its ID in a post's attachmentIds within a day; one no post takes by then is removed.",
    ),
    400: errorResponse(
      "The body isn't an image of its Content-Type, or the model doesn't read images; the message says why",
    ),
    413: errorResponse("The image is larger than the API takes"),
    415: errorResponse("The Content-Type isn't one of the image types the API takes"),
    ...signedIn,
  },
});

/** POST /api/attachments: puts up an image to send with a post. */
export const putUpAttachment = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const mediaType = c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase();
    if (!isAttachmentMediaType(mediaType)) {
      return c.json(
        { message: `The Content-Type must be one of ${ATTACHMENT_MEDIA_TYPES.join(", ")}.` },
        415,
      );
    }
    if (!canAttachImages(c.env)) {
      return c.json({ message: NO_IMAGES }, 400);
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      return c.json({ message: `An image can be at most ${MAX_ATTACHMENT_BYTES} bytes.` }, 413);
    }
    if (!looksLike(mediaType, bytes)) {
      return c.json({ message: `The body isn't an image of type ${mediaType}.` }, 400);
    }
    const attachment = { id: crypto.randomUUID(), mediaType, size: bytes.byteLength };
    const key = attachmentKey(c.var.user.id, attachment.id);
    await c.env.ATTACHMENTS.put(key, bytes, { httpMetadata: { contentType: mediaType } });
    let removed: string[];
    try {
      removed = await c.var.agents.addAttachment(attachment);
    } catch (error) {
      await c.env.ATTACHMENTS.delete(key);
      throw error;
    }
    if (removed.length > 0) {
      await c.env.ATTACHMENTS.delete(removed.map((id) => attachmentKey(c.var.user.id, id)));
    }
    return c.json(attachment, 201);
  },
});
