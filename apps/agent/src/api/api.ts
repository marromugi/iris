import { OpenAPIHono, z } from "@hono/zod-openapi";
import { answerError } from "./errors";
import { type ApiEnv, signedInUser } from "./middlewares/signed-in-user";
import { recentRuns } from "./routes/runs/get";
import { removeTask } from "./routes/tasks/[taskId]/delete";
import { listTasks } from "./routes/tasks/get";
import { addTask } from "./routes/tasks/post";

export type { UserProps } from "./middlewares/signed-in-user";

/**
 * Where the Worker is expected to serve `/api` once deployed (nothing is deployed yet); the
 * OpenAPI document names it as the server.
 */
export const PRODUCTION_ORIGIN = "https://iris-agent.marrromugi-dev.workers.dev";

/**
 * `/api`: a signed-in user's tasks and runs, for requests the OAuth layer let through with
 * `UserProps`. A request without them is 403; one that doesn't fit the API is 400 with a message
 * saying why. Every answer with a body is JSON (a removal's 204 has none, nor does the OAuth
 * layer's 401 without a token), and none is cached.
 */
export const agentApi = new OpenAPIHono<ApiEnv>({
  defaultHook: (result, c) =>
    result.success ? undefined : c.json({ message: z.prettifyError(result.error) }, 400),
});

agentApi.use("*", signedInUser);
agentApi.notFound((c) => c.json({ message: "Not found" }, 404));
agentApi.onError(answerError);
agentApi.openapiRoutes([listTasks, addTask, removeTask, recentRuns]);

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
        "A user's scheduled tasks and their runs. Errors are { message }, except 401, which comes from the OAuth layer.",
    },
    servers: [{ url: origin }],
    security: [{ iris: [] }],
  });
}
