import { createRoute, defineOpenAPIRoute } from "@hono/zod-openapi";
import type { Answer } from "../../../../answer";
import { invalid, signedIn } from "../../../../errors";
import type { ApiEnv } from "../../../../middlewares/signed-in-user";
import { agentParams, NO_SUCH_AGENT, noSuchAgent } from "../params";

const route = createRoute({
  operationId: "activateAgent",
  method: "post",
  path: "/api/agents/{agentId}/activate",
  request: { params: agentParams },
  responses: {
    204: {
      description: "Active, or already was. Its tasks next run at their first time after now.",
    },
    ...noSuchAgent,
    ...invalid,
    ...signedIn,
  },
});

/** POST /api/agents/{agentId}/activate: activates one of the signed-in user's agents again. */
export const activateAgent = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const found = await c.var.agents.activateAgent(c.req.valid("param").agentId);
    return found ? c.body(null, 204) : c.json({ message: NO_SUCH_AGENT }, 404);
  },
});
