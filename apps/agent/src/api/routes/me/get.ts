import { createRoute, defineOpenAPIRoute, z } from "@hono/zod-openapi";
import { canAttachImages } from "../../../model-provider";
import type { Answer } from "../../answer";
import { signedIn } from "../../errors";
import type { ApiEnv } from "../../middlewares/signed-in-user";
import { json } from "../../schemas";

const meSchema = z
  .object({
    id: z.uuid(),
    name: z.string().meta({ description: "The name the user's invite gave them" }),
    canAttachImages: z.boolean().meta({
      description:
        "Whether posts may carry images: false when the model the agents think with doesn't read them",
    }),
  })
  .meta({ id: "Me" });

const route = createRoute({
  operationId: "me",
  method: "get",
  path: "/api/me",
  responses: {
    200: json(meSchema, "The signed-in user"),
    ...signedIn,
  },
});

/** GET /api/me: who is signed in. */
export const me = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: (c): Answer<typeof route> =>
    c.json(
      { id: c.var.user.id, name: c.var.user.name, canAttachImages: canAttachImages(c.env) },
      200,
    ),
});
