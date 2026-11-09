import { createRoute, defineOpenAPIRoute, z } from "@hono/zod-openapi";
import { DEFAULT_RECENT_RUNS, MAX_RECENT_RUNS } from "../../../runs";
import { invalid, signedIn } from "../../errors";
import type { ApiEnv } from "../../middlewares/signed-in-user";
import { json, runJson, runSchema } from "../../schemas";

const route = createRoute({
  operationId: "recentRuns",
  method: "get",
  path: "/api/runs",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(MAX_RECENT_RUNS).default(DEFAULT_RECENT_RUNS),
    }),
  },
  responses: {
    200: json(z.array(runSchema), "The user's latest runs first, each with its conversation"),
    ...invalid,
    ...signedIn,
  },
});

/** GET /api/runs: the signed-in user's latest runs, each with its conversation. */
export const recentRuns = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c) => {
    const runs = await c.var.agent.recentRuns(c.req.valid("query").limit);
    return c.json(runs.map(runJson), 200);
  },
});
