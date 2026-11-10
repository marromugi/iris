import { createRoute, defineOpenAPIRoute } from "@hono/zod-openapi";
import { newAgentSchema } from "../../../agent";
import type { Answer } from "../../answer";
import { errorResponse, invalid, signedIn } from "../../errors";
import type { ApiEnv } from "../../middlewares/signed-in-user";
import { agentJson, agentSchema, json } from "../../schemas";

const route = createRoute({
  operationId: "addAgent",
  method: "post",
  path: "/api/agents",
  request: {
    body: {
      content: { "application/json": { schema: newAgentSchema.meta({ id: "NewAgent" }) } },
      required: true,
    },
  },
  responses: {
    201: json(agentSchema, "The agent added, last in the list"),
    415: errorResponse("The body isn't sent as application/json"),
    ...invalid,
    ...signedIn,
  },
});

/** POST /api/agents: adds an agent for the signed-in user, or says why it can't. */
export const addAgent = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const added = await c.var.agents.addAgent(c.req.valid("json"));
    return added.ok ? c.json(agentJson(added.agent), 201) : c.json({ message: added.error }, 400);
  },
});
