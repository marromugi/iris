import { createRoute, defineOpenAPIRoute } from "@hono/zod-openapi";
import type { Answer } from "../../../../answer";
import { newTaskSchema } from "../../../../../task";
import { errorResponse, invalid, signedIn } from "../../../../errors";
import type { ApiEnv } from "../../../../middlewares/signed-in-user";
import { json, taskJson, taskSchema } from "../../../../schemas";
import { agentParams, NO_SUCH_AGENT, noSuchAgent } from "../params";

const route = createRoute({
  operationId: "addTask",
  method: "post",
  path: "/api/agents/{agentId}/tasks",
  request: {
    params: agentParams,
    body: {
      content: { "application/json": { schema: newTaskSchema.meta({ id: "NewTask" }) } },
      required: true,
    },
  },
  responses: {
    201: json(taskSchema, "The task added"),
    ...noSuchAgent,
    415: errorResponse("The body isn't sent as application/json"),
    ...invalid,
    ...signedIn,
  },
});

/** POST /api/agents/{agentId}/tasks: adds a task to one of the signed-in user's agents, or says why it can't. */
export const addTask = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const added = await c.var.agents.addTask(c.req.valid("param").agentId, c.req.valid("json"));
    if (added === undefined) {
      return c.json({ message: NO_SUCH_AGENT }, 404);
    }
    return added.ok ? c.json(taskJson(added.task), 201) : c.json({ message: added.error }, 400);
  },
});
