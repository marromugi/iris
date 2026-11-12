import { createRoute, defineOpenAPIRoute, z } from "@hono/zod-openapi";
import type { Answer } from "../../../../answer";
import { newMessageSchema } from "../../../../../message";
import { errorResponse, signedIn } from "../../../../errors";
import type { ApiEnv } from "../../../../middlewares/signed-in-user";
import { json, postJson, postSchema, runJson, runSchema } from "../../../../schemas";
import { NO_SUCH_THREAD, noSuchThread, threadParams } from "../params";

const route = createRoute({
  operationId: "sendPost",
  method: "post",
  path: "/api/threads/{threadId}/posts",
  request: {
    params: threadParams,
    body: {
      content: { "application/json": { schema: newMessageSchema.meta({ id: "NewMessage" }) } },
      required: true,
    },
  },
  responses: {
    202: json(
      z.object({ post: postSchema, runs: z.array(runSchema) }).meta({ id: "SentPost" }),
      "The post, and the runs that reply to it as they start: one for each member named with @ and its name, or for every member when none is. Each reply is added to its run.",
    ),
    ...noSuchThread,
    415: errorResponse("The body isn't sent as application/json"),
    400: errorResponse(
      "The request doesn't fit the API, or every agent that would reply is deactivated; the message says why",
    ),
    ...signedIn,
  },
});

/** POST /api/threads/{threadId}/posts: sends a post in one of the signed-in user's threads, which starts its members' replies. */
export const sendPost = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const sent = await c.var.agents.post(c.req.valid("param").threadId, c.req.valid("json"));
    if (sent === undefined) {
      return c.json({ message: NO_SUCH_THREAD }, 404);
    }
    return sent.ok
      ? c.json({ post: postJson(sent.post), runs: sent.runs.map(runJson) }, 202)
      : c.json({ message: sent.error }, 400);
  },
});
