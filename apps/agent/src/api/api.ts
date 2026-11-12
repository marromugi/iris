import { OpenAPIHono, z } from "@hono/zod-openapi";
import { answerError } from "./errors";
import { type ApiEnv, signedInUser } from "./middlewares/signed-in-user";
import { activateAgent } from "./routes/agents/[agentId]/activate/post";
import { deactivateAgent } from "./routes/agents/[agentId]/deactivate/post";
import { EVENTS_PATH, openEvents } from "./routes/agents/[agentId]/events/get";
import { sendMessage } from "./routes/agents/[agentId]/messages/post";
import { recentRuns } from "./routes/agents/[agentId]/runs/get";
import { removeTask } from "./routes/agents/[agentId]/tasks/[taskId]/delete";
import { listTasks } from "./routes/agents/[agentId]/tasks/get";
import { addTask } from "./routes/agents/[agentId]/tasks/post";
import { listAgents } from "./routes/agents/get";
import { addAgent } from "./routes/agents/post";
import { me } from "./routes/me/get";
import { threadEntries } from "./routes/threads/[threadId]/entries/get";
import { openThreadEvents, THREAD_EVENTS_PATH } from "./routes/threads/[threadId]/events/get";
import { sendPost } from "./routes/threads/[threadId]/posts/post";
import { listThreads } from "./routes/threads/get";
import { addGroup } from "./routes/threads/post";
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
 * JSON (a removal's or a deactivation's 204 has none), and none is cached. The OAuth layer's 401 comes before `/api`
 * and is its own.
 */
export const agentApi = new OpenAPIHono<ApiEnv>({
  defaultHook: (result, c) =>
    result.success ? undefined : c.json({ message: z.prettifyError(result.error) }, 400),
});

agentApi.use("*", signedInUser);
agentApi.notFound((c) => c.json({ message: "Not found" }, 404));
agentApi.onError(answerError);
agentApi.openapiRoutes([
  me,
  listAgents,
  addAgent,
  deactivateAgent,
  activateAgent,
  listTasks,
  addTask,
  removeTask,
  recentRuns,
  sendMessage,
  listThreads,
  addGroup,
  threadEntries,
  sendPost,
]);
agentApi.get(EVENTS_PATH, openEvents);
agentApi.get(THREAD_EVENTS_PATH, openThreadEvents);
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
        "A user's agents, which they can add, and their threads: each agent's one-to-one thread and groups of agents. In a thread the user sends posts, and the members named with @, or all of them when none is, reply with runs; an agent's scheduled tasks also start runs in its one-to-one thread. /api/agents/{agentId}/messages, runs and events work on the agent's one-to-one thread. Errors are { message }, except 401, which comes from the OAuth layer. GET /api/threads/{threadId}/events with a WebSocket upgrade opens a socket that sends the thread's posts, its runs as they change, and how the one being carried on is getting on (RunEvent); /api/agents/{agentId}/events does the same for the agent's one-to-one thread without posts.",
    },
    servers: [{ url: origin }],
    security: [{ iris: [] }],
  });
}
