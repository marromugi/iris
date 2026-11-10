import { createRoute, defineOpenAPIRoute, z } from "@hono/zod-openapi";
import type { Answer } from "../../answer";
import { signedIn } from "../../errors";
import type { ApiEnv } from "../../middlewares/signed-in-user";
import { json, threadJson, threadSchema } from "../../schemas";

const route = createRoute({
  operationId: "listThreads",
  method: "get",
  path: "/api/threads",
  responses: {
    200: json(
      z.array(threadSchema),
      "The user's threads, each agent's one-to-one thread and the groups together, the latest activity first",
    ),
    ...signedIn,
  },
});

/** GET /api/threads: the signed-in user's threads, as the home lists them. */
export const listThreads = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const threads = await c.var.agents.listThreads();
    return c.json(threads.map(threadJson), 200);
  },
});
