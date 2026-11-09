import { createRoute, defineOpenAPIRoute, z } from "@hono/zod-openapi";
import type { Answer } from "../../answer";
import { signedIn } from "../../errors";
import type { ApiEnv } from "../../middlewares/signed-in-user";
import { json, taskJson, taskSchema } from "../../schemas";

const route = createRoute({
  operationId: "listTasks",
  method: "get",
  path: "/api/tasks",
  responses: {
    200: json(z.array(taskSchema), "The user's tasks, the next to run first"),
    ...signedIn,
  },
});

/** GET /api/tasks: the signed-in user's tasks. */
export const listTasks = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const tasks = await c.var.agent.listTasks();
    return c.json(tasks.map(taskJson), 200);
  },
});
