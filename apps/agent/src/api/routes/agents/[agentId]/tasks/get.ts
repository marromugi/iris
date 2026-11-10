import { createRoute, defineOpenAPIRoute, z } from "@hono/zod-openapi";
import type { Answer } from "../../../../answer";
import { invalid, signedIn } from "../../../../errors";
import type { ApiEnv } from "../../../../middlewares/signed-in-user";
import { json, taskJson, taskSchema } from "../../../../schemas";
import { agentParams, NO_SUCH_AGENT, noSuchAgent } from "../params";

const route = createRoute({
  operationId: "listTasks",
  method: "get",
  path: "/api/agents/{agentId}/tasks",
  request: { params: agentParams },
  responses: {
    200: json(z.array(taskSchema), "The agent's tasks, the next to run first"),
    ...noSuchAgent,
    ...invalid,
    ...signedIn,
  },
});

/** GET /api/agents/{agentId}/tasks: one of the signed-in user's agents' tasks. */
export const listTasks = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const tasks = await c.var.agents.listTasks(c.req.valid("param").agentId);
    return tasks === undefined
      ? c.json({ message: NO_SUCH_AGENT }, 404)
      : c.json(tasks.map(taskJson), 200);
  },
});
