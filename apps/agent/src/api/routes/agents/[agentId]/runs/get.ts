import { createRoute, defineOpenAPIRoute, z } from "@hono/zod-openapi";
import type { Answer } from "../../../../answer";
import { DEFAULT_RECENT_RUNS, MAX_RECENT_RUNS } from "../../../../../runs";
import { invalid, signedIn } from "../../../../errors";
import type { ApiEnv } from "../../../../middlewares/signed-in-user";
import { json, runJson, runSchema } from "../../../../schemas";
import { agentParams, NO_SUCH_AGENT, noSuchAgent } from "../params";

const route = createRoute({
  operationId: "recentRuns",
  method: "get",
  path: "/api/agents/{agentId}/runs",
  request: {
    params: agentParams,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(MAX_RECENT_RUNS).default(DEFAULT_RECENT_RUNS),
    }),
  },
  responses: {
    200: json(z.array(runSchema), "The agent's latest runs first, each with its conversation"),
    ...noSuchAgent,
    ...invalid,
    ...signedIn,
  },
});

/** GET /api/agents/{agentId}/runs: one of the signed-in user's agents' latest runs, each with its conversation. */
export const recentRuns = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const runs = await c.var.agents.recentRuns(
      c.req.valid("param").agentId,
      c.req.valid("query").limit,
    );
    return runs === undefined
      ? c.json({ message: NO_SUCH_AGENT }, 404)
      : c.json(runs.map(runJson), 200);
  },
});
