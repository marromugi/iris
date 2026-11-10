import { createRoute, defineOpenAPIRoute, z } from "@hono/zod-openapi";
import type { Answer } from "../../answer";
import { signedIn } from "../../errors";
import type { ApiEnv } from "../../middlewares/signed-in-user";
import { agentJson, agentSchema, json } from "../../schemas";

const route = createRoute({
  operationId: "listAgents",
  method: "get",
  path: "/api/agents",
  responses: {
    200: json(z.array(agentSchema), "The user's agents in the order they were added"),
    ...signedIn,
  },
});

/** GET /api/agents: the signed-in user's agents. */
export const listAgents = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const agents = await c.var.agents.listAgents();
    return c.json(agents.map(agentJson), 200);
  },
});
