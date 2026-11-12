import { createRoute, defineOpenAPIRoute, z } from "@hono/zod-openapi";
import { ATTACHMENT_MEDIA_TYPES, attachmentKey } from "../../../../attachment";
import type { Answer } from "../../../answer";
import { errorResponse, signedIn } from "../../../errors";
import type { ApiEnv } from "../../../middlewares/signed-in-user";

export const NO_SUCH_ATTACHMENT_ID = "No image of this user has this ID";

const route = createRoute({
  operationId: "attachment",
  method: "get",
  path: "/api/attachments/{attachmentId}",
  request: { params: z.object({ attachmentId: z.uuid() }) },
  responses: {
    200: {
      content: Object.fromEntries(
        ATTACHMENT_MEDIA_TYPES.map((type) => [
          type,
          { schema: z.string().meta({ format: "binary" }) },
        ]),
      ),
      description: "The image's bytes, with the Content-Type it was put up with",
    },
    404: errorResponse(NO_SUCH_ATTACHMENT_ID),
    ...signedIn,
  },
});

/** GET /api/attachments/{attachmentId}: the bytes of an image the user put up. */
export const attachment = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const { attachmentId } = c.req.valid("param");
    const kept = await c.var.agents.attachment(attachmentId);
    const object =
      kept === undefined
        ? null
        : await c.env.ATTACHMENTS.get(attachmentKey(c.var.user.id, attachmentId));
    if (kept === undefined || object === null) {
      return c.json({ message: NO_SUCH_ATTACHMENT_ID }, 404);
    }
    return c.body(object.body, 200, {
      "Content-Type": kept.mediaType,
      "Content-Length": String(kept.size),
    }) as Answer<typeof route>;
  },
});
