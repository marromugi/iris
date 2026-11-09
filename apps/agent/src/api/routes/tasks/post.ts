import { createRoute, defineOpenAPIRoute } from "@hono/zod-openapi";
import type { Answer } from "../../answer";
import { newTaskSchema } from "../../../task";
import { errorResponse, invalid, signedIn } from "../../errors";
import type { ApiEnv } from "../../middlewares/signed-in-user";
import { json, taskJson, taskSchema } from "../../schemas";

const route = createRoute({
  operationId: "addTask",
  method: "post",
  path: "/api/tasks",
  request: {
    body: {
      content: { "application/json": { schema: newTaskSchema.meta({ id: "NewTask" }) } },
      required: true,
    },
  },
  responses: {
    201: json(taskSchema, "The task added"),
    415: errorResponse("The body isn't sent as application/json"),
    ...invalid,
    ...signedIn,
  },
});

/** POST /api/tasks: adds a task for the signed-in user, or says why it can't. */
export const addTask = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const added = await c.var.agent.addTask(c.req.valid("json"));
    return added.ok ? c.json(taskJson(added.task), 201) : c.json({ message: added.error }, 400);
  },
});
