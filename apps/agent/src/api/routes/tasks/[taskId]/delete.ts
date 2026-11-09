import { createRoute, defineOpenAPIRoute, z } from "@hono/zod-openapi";
import { errorResponse, invalid, signedIn } from "../../../errors";
import type { ApiEnv } from "../../../middlewares/signed-in-user";

const NO_SUCH_TASK = "No task of this user has this ID";

const route = createRoute({
  operationId: "removeTask",
  method: "delete",
  path: "/api/tasks/{taskId}",
  request: { params: z.object({ taskId: z.uuid() }) },
  responses: {
    204: { description: "Removed. Runs it already started carry on." },
    404: errorResponse(NO_SUCH_TASK),
    ...invalid,
    ...signedIn,
  },
});

/** DELETE /api/tasks/{taskId}: removes one of the signed-in user's tasks. */
export const removeTask = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c) => {
    const removed = await c.var.agent.removeTask(c.req.valid("param").taskId);
    return removed ? c.body(null, 204) : c.json({ message: NO_SUCH_TASK }, 404);
  },
});
