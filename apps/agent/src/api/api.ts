import { OpenAPIHono, z } from "@hono/zod-openapi";
import { answerError } from "./errors";
import { type ApiEnv, signedInUser } from "./middlewares/signed-in-user";
import { EVENTS_PATH, openEvents } from "./routes/agents/[agentId]/events/get";
import { sendMessage } from "./routes/agents/[agentId]/messages/post";
import { recentRuns } from "./routes/agents/[agentId]/runs/get";
import { removeTask } from "./routes/agents/[agentId]/tasks/[taskId]/delete";
import { listTasks } from "./routes/agents/[agentId]/tasks/get";
import { addTask } from "./routes/agents/[agentId]/tasks/post";
import { listAgents } from "./routes/agents/get";
import { me } from "./routes/me/get";
import { runEventSchema } from "./schemas";

export type { UserProps } from "./middlewares/signed-in-user";

/**
 * Where the Worker serves `/api`; the OpenAPI document names it as the server. The
 * Worker's `ORIGIN` in wrangler.jsonc is the same, which the test of openapi.json holds.
 */
export const PRODUCTION_ORIGIN = "https://iris-agent.marrromugi-dev.workers.dev";

/**
 * `/api`: who is signed in, and their agents with each one's tasks and runs, for requests the OAuth layer let through with
 * `UserProps`. A request without them, or for a user that no longer exists, is 403; one that
 * doesn't fit the API is 400 with a message saying why. Every answer `/api` gives with a body is
 * JSON (a removal's 204 has none), and none is cached. The OAuth layer's 401 comes before `/api`
 * and is its own.
 */
export const agentApi = new OpenAPIHono<ApiEnv>({
  defaultHook: (result, c) =>
    result.success ? undefined : c.json({ message: z.prettifyError(result.error) }, 400),
});

agentApi.use("*", signedInUser);
agentApi.notFound((c) => c.json({ message: "Not found" }, 404));
agentApi.onError(answerError);
agentApi.openapiRoutes([me, listAgents, listTasks, addTask, removeTask, recentRuns, sendMessage]);
agentApi.get(EVENTS_PATH, openEvents);
agentApi.openAPIRegistry.register("RunEvent", runEventSchema);

agentApi.openAPIRegistry.registerComponent("securitySchemes", "iris", {
  type: "oauth2",
  description:
    "Sign in through the sheet at /authorize with resource set to the /api URL, using PKCE.",
  flows: { authorizationCode: { authorizationUrl: "/authorize", tokenUrl: "/token", scopes: {} } },
});

/** The OpenAPI document for `/api`, served from `origin`. */
export function agentApiDocument(origin: string) {
  return agentApi.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "iris",
      version: "1",
      description:
        "A user's agents, with each one's scheduled tasks and its runs, which its tasks and the messages sent to it start. Errors are { message }, except 401, which comes from the OAuth layer. GET /api/agents/{agentId}/events with a WebSocket upgrade opens a socket that sends the agent's runs as they change and how the one being carried on is getting on (RunEvent).",
    },
    servers: [{ url: origin }],
    security: [{ iris: [] }],
  });
}
