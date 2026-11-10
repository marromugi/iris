import { createRoute, defineOpenAPIRoute, z } from "@hono/zod-openapi";
import type { Answer } from "../../../../answer";
import { DEFAULT_RECENT_RUNS, MAX_RECENT_RUNS } from "../../../../../runs";
import { invalid, signedIn } from "../../../../errors";
import type { ApiEnv } from "../../../../middlewares/signed-in-user";
import { json, postJson, runJson, threadEntrySchema } from "../../../../schemas";
import { NO_SUCH_THREAD, noSuchThread, threadParams } from "../params";

const route = createRoute({
  operationId: "threadEntries",
  method: "get",
  path: "/api/threads/{threadId}/entries",
  request: {
    params: threadParams,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(MAX_RECENT_RUNS).default(DEFAULT_RECENT_RUNS),
    }),
  },
  responses: {
    200: json(
      z.array(threadEntrySchema),
      "The thread's latest posts and runs together, the latest first; a post comes after the runs that reply to it",
    ),
    ...noSuchThread,
    ...invalid,
    ...signedIn,
  },
});

/** GET /api/threads/{threadId}/entries: the latest posts and runs of one of the signed-in user's threads. */
export const threadEntries = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const entries = await c.var.agents.threadEntries(
      c.req.valid("param").threadId,
      c.req.valid("query").limit,
    );
    if (entries === undefined) {
      return c.json({ message: NO_SUCH_THREAD }, 404);
    }
    return c.json(
      entries.map((entry) =>
        entry.type === "post"
          ? { type: "post" as const, post: postJson(entry.post) }
          : { type: "run" as const, run: runJson(entry.run) },
      ),
      200,
    );
  },
});
