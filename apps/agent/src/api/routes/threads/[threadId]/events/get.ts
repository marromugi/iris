import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ApiEnv } from "../../../../middlewares/signed-in-user";
import { NO_SUCH_THREAD, threadParams } from "../params";

/** Where the WebSocket of one thread's events is opened. Not in the OpenAPI document, which can't describe one. */
export const THREAD_EVENTS_PATH = "/api/threads/:threadId/events";

/**
 * GET /api/threads/{threadId}/events with a WebSocket upgrade: opens the socket on which the
 * server sends the thread's runs and posts as `RunEvent`s. 404 for a thread the user doesn't have,
 * 400 for an ID that isn't one, 426 without the upgrade.
 */
export async function openThreadEvents(c: Context<ApiEnv>): Promise<Response> {
  const params = threadParams.safeParse({ threadId: c.req.param("threadId") });
  if (!params.success) {
    return c.json({ message: z.prettifyError(params.error) }, 400);
  }
  // The object's own URL only carries the thread; the request's headers carry the upgrade.
  const url = new URL("https://user-agent/events");
  url.searchParams.set("threadId", params.data.threadId);
  const response = await c.var.agents.fetch(new Request(url, { headers: c.req.raw.headers }));
  if (response.status === 404) {
    return c.json({ message: NO_SUCH_THREAD }, 404);
  }
  if (response.status === 426) {
    return c.json({ message: "Open this as a WebSocket" }, 426);
  }
  return response;
}
