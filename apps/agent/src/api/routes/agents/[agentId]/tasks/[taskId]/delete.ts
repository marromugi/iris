import { createRoute, defineOpenAPIRoute, z } from "@hono/zod-openapi";
import type { Answer } from "../../../../../answer";
import { errorResponse, invalid, signedIn } from "../../../../../errors";
import type { ApiEnv } from "../../../../../middlewares/signed-in-user";
import { agentParams, NO_SUCH_AGENT } from "../../params";

const NO_SUCH_TASK = "No task of this agent has this ID";

const route = createRoute({
  operationId: "removeTask",
  method: "delete",
  path: "/api/agents/{agentId}/tasks/{taskId}",
  request: { params: agentParams.extend({ taskId: z.uuid() }) },
  responses: {
    204: { description: "Removed. Runs it already started carry on." },
    404: errorResponse(`${NO_SUCH_AGENT}, or ${NO_SUCH_TASK}`),
    ...invalid,
    ...signedIn,
  },
});

/** DELETE /api/agents/{agentId}/tasks/{taskId}: removes a task from one of the signed-in user's agents. */
export const removeTask = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const { agentId, taskId } = c.req.valid("param");
    const removed = await c.var.agents.removeTask(agentId, taskId);
    if (removed === undefined) {
      return c.json({ message: NO_SUCH_AGENT }, 404);
    }
    return removed ? c.body(null, 204) : c.json({ message: NO_SUCH_TASK }, 404);
  },
});
