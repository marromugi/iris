import type { Context } from "hono";
import type { ApiEnv } from "../../../middlewares/signed-in-user";

/** Where the WebSocket of the user's own events is opened. Not in the OpenAPI document, which can't describe one. */
export const USER_EVENTS_PATH = "/api/me/events";

/**
 * GET /api/me/events with a WebSocket upgrade: opens the socket on which the server sends the
 * user's own events as `UserEvent`s. 426 without the upgrade.
 */
export async function openUserEvents(c: Context<ApiEnv>): Promise<Response> {
  // The object's own URL only says which socket; the request's headers carry the upgrade.
  const url = new URL("https://user-agent/events");
  url.searchParams.set("user", "");
  const response = await c.var.agents.fetch(new Request(url, { headers: c.req.raw.headers }));
  if (response.status === 426) {
    return c.json({ message: "Open this as a WebSocket" }, 426);
  }
  return response;
}
