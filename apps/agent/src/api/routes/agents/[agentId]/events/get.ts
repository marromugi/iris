import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ApiEnv } from "../../../../middlewares/signed-in-user";
import { agentParams, NO_SUCH_AGENT } from "../params";

/** Where the WebSocket of one agent's events is opened. Not in the OpenAPI document, which can't describe one. */
export const EVENTS_PATH = "/api/agents/:agentId/events";

/**
 * GET /api/agents/{agentId}/events with a WebSocket upgrade: opens the socket on which the
 * server sends the agent's runs as `RunEvent`s. 404 for an agent the user doesn't have, 400 for an
 * ID that isn't one, 426 without the upgrade.
 */
export async function openEvents(c: Context<ApiEnv>): Promise<Response> {
  const params = agentParams.safeParse({ agentId: c.req.param("agentId") });
  if (!params.success) {
    return c.json({ message: z.prettifyError(params.error) }, 400);
  }
  // The object's own URL only carries the agent; the request's headers carry the upgrade.
  const url = new URL("https://user-agent/events");
  url.searchParams.set("agentId", params.data.agentId);
  const response = await c.var.agents.fetch(new Request(url, { headers: c.req.raw.headers }));
  if (response.status === 404) {
    return c.json({ message: NO_SUCH_AGENT }, 404);
  }
  if (response.status === 426) {
    return c.json({ message: "Open this as a WebSocket" }, 426);
  }
  return response;
}
