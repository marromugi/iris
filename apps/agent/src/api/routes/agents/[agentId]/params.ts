import { z } from "@hono/zod-openapi";
import { errorResponse } from "../../../errors";

/** The path of one of the user's agents. */
export const agentParams = z.object({ agentId: z.uuid() });

export const NO_SUCH_AGENT = "No agent of this user has this ID";

/** What a route under one agent answers when the user has no agent with its ID. */
export const noSuchAgent = { 404: errorResponse(NO_SUCH_AGENT) };
