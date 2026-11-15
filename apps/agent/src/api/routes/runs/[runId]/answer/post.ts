import { createRoute, defineOpenAPIRoute, z } from "@hono/zod-openapi";
import { newAnswerSchema } from "../../../../../question";
import type { Answer } from "../../../../answer";
import { errorResponse, signedIn } from "../../../../errors";
import type { ApiEnv } from "../../../../middlewares/signed-in-user";
import { json, runJson, runSchema } from "../../../../schemas";

const NO_SUCH_RUN = "No run of this user has this ID";

const route = createRoute({
  operationId: "answerQuestion",
  method: "post",
  path: "/api/runs/{runId}/answer",
  request: {
    params: z.object({ runId: z.uuid() }),
    body: {
      content: { "application/json": { schema: newAnswerSchema.meta({ id: "NewAnswer" }) } },
      required: true,
    },
  },
  responses: {
    202: json(
      runSchema,
      "The run with the answer as its question's result. It carries on from there, and its reply is added to it.",
    ),
    404: errorResponse(NO_SUCH_RUN),
    409: errorResponse("The run isn't waiting for an answer: it has ended, or hasn't asked"),
    415: errorResponse("The body isn't sent as application/json"),
    400: errorResponse("The request doesn't fit the API, or the answer is empty"),
    ...signedIn,
  },
});

/** POST /api/runs/{runId}/answer: answers the question one of the signed-in user's runs waits on, which carries the run on. */
export const answerQuestion = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const answered = await c.var.agents.answerQuestion(
      c.req.valid("param").runId,
      c.req.valid("json").answer,
    );
    if (answered === undefined) {
      return c.json({ message: NO_SUCH_RUN }, 404);
    }
    return answered.ok
      ? c.json(runJson(answered.run), 202)
      : c.json({ message: answered.error }, 409);
  },
});
