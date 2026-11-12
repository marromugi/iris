import { createRoute, defineOpenAPIRoute } from "@hono/zod-openapi";
import type { Answer } from "../../../../answer";
import { newMessageSchema } from "../../../../../message";
import { canAttachImages } from "../../../../../model-provider";
import { errorResponse, signedIn } from "../../../../errors";
import { NO_IMAGES } from "../../../attachments/post";
import type { ApiEnv } from "../../../../middlewares/signed-in-user";
import { json, runJson, runSchema } from "../../../../schemas";
import { agentParams, NO_SUCH_AGENT, noSuchAgent } from "../params";

const route = createRoute({
  operationId: "sendMessage",
  method: "post",
  path: "/api/agents/{agentId}/messages",
  request: {
    params: agentParams,
    body: {
      content: { "application/json": { schema: newMessageSchema.meta({ id: "NewMessage" }) } },
      required: true,
    },
  },
  responses: {
    202: json(
      runSchema,
      "The run the message started, with the message as its only one. The agent's reply is added to it, and it is one of the agent's runs.",
    ),
    ...noSuchAgent,
    415: errorResponse("The body isn't sent as application/json"),
    400: errorResponse(
      "The request doesn't fit the API, every agent that would reply is deactivated, an image isn't there or was already sent, or images are sent while the model doesn't read them; the message says why",
    ),
    ...signedIn,
  },
});

/** POST /api/agents/{agentId}/messages: sends a message to one of the signed-in user's agents, which starts a run of it. */
export const sendMessage = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    if ((c.req.valid("json").attachmentIds ?? []).length > 0 && !canAttachImages(c.env)) {
      return c.json({ message: NO_IMAGES }, 400);
    }
    const sent = await c.var.agents.sendMessage(c.req.valid("param").agentId, c.req.valid("json"));
    if (sent === undefined) {
      return c.json({ message: NO_SUCH_AGENT }, 404);
    }
    return sent.ok ? c.json(runJson(sent.run), 202) : c.json({ message: sent.error }, 400);
  },
});
