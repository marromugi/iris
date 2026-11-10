import { createRoute, defineOpenAPIRoute } from "@hono/zod-openapi";
import { newGroupSchema } from "../../../group";
import type { Answer } from "../../answer";
import { errorResponse, invalid, signedIn } from "../../errors";
import type { ApiEnv } from "../../middlewares/signed-in-user";
import { json, threadJson, threadSchema } from "../../schemas";

const route = createRoute({
  operationId: "addGroup",
  method: "post",
  path: "/api/threads",
  request: {
    body: {
      content: { "application/json": { schema: newGroupSchema.meta({ id: "NewGroup" }) } },
      required: true,
    },
  },
  responses: {
    201: json(threadSchema, "The group made"),
    415: errorResponse("The body isn't sent as application/json"),
    ...invalid,
    ...signedIn,
  },
});

/** POST /api/threads: makes a group of two or more of the signed-in user's agents, or says why it can't. */
export const addGroup = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const added = await c.var.agents.addGroup(c.req.valid("json"));
    return added.ok ? c.json(threadJson(added.thread), 201) : c.json({ message: added.error }, 400);
  },
});
