import { createRoute, defineOpenAPIRoute } from "@hono/zod-openapi";
import type { Answer } from "../../../../answer";
import { invalid, signedIn } from "../../../../errors";
import type { ApiEnv } from "../../../../middlewares/signed-in-user";
import { agentParams, NO_SUCH_AGENT, noSuchAgent } from "../params";

const route = createRoute({
  operationId: "deactivateAgent",
  method: "post",
  path: "/api/agents/{agentId}/deactivate",
  request: { params: agentParams },
  responses: {
    204: {
      description:
        "Deactivated, or already was. It replies to nothing and its tasks don't run until it is activated; its runs that hadn't ended end without a reply. Everything it has stays.",
    },
    ...noSuchAgent,
    ...invalid,
    ...signedIn,
  },
});

/** POST /api/agents/{agentId}/deactivate: deactivates one of the signed-in user's agents. */
export const deactivateAgent = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const found = await c.var.agents.deactivateAgent(c.req.valid("param").agentId);
    return found ? c.body(null, 204) : c.json({ message: NO_SUCH_AGENT }, 404);
  },
});
