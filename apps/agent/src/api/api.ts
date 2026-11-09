import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import {
  assistantMessageSchema,
  textPartSchema,
  toolCallPartSchema,
  toolResultMessageSchema,
  userMessageSchema,
} from "@iris/agent";
import { DEFAULT_RECENT_RUNS, MAX_RECENT_RUNS } from "../runs";
import { scheduleSchema } from "../schedule";
import type { Run, Task } from "../store";
import { newTaskSchema } from "../task";

/** What the OAuth layer hands `/api` for a signed-in user. `userId` also names their Durable Object. */
const userPropsSchema = z.object({ userId: z.string().min(1) });

export type UserProps = z.infer<typeof userPropsSchema>;

/**
 * Where the Worker is expected to serve `/api` once deployed (nothing is deployed yet); the
 * OpenAPI document names it as the server.
 */
export const PRODUCTION_ORIGIN = "https://iris-agent.marrromugi-dev.workers.dev";

const NO_SUCH_TASK = "No task of this user has this ID";

const errorSchema = z.object({ message: z.string() }).meta({ id: "Error" });

// Whole seconds: clients' default ISO 8601 parsers (Swift's among them) reject fractional seconds.
const timeSchema = z.iso.datetime({ precision: 0 });

function timeJson(time: Date): string {
  return time.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const taskSchema = z
  .object({
    id: z.uuid(),
    prompt: z.string(),
    schedule: scheduleSchema,
    nextRunAt: timeSchema,
  })
  .meta({ id: "Task" });

// An assistant message's part types as @iris/agent defines them. Typed as exactly these two, so
// a part type added there stops this from compiling until the API document says how to send it.
const [textPart, toolCallPart]: readonly [typeof textPartSchema, typeof toolCallPartSchema] =
  assistantMessageSchema.shape.parts.element.options;

// A message as @iris/agent defines it, except that a tool call's input is written as any value:
// the OpenAPI generator can't describe the JSON-value check the agent runs on it.
const messageSchema = z
  .discriminatedUnion("role", [
    userMessageSchema,
    assistantMessageSchema.extend({
      parts: z.array(
        z.discriminatedUnion("type", [
          textPart,
          toolCallPart.extend({
            input: z.unknown().meta({ description: "The tool's input: any JSON value" }),
          }),
        ]),
      ),
    }),
    toolResultMessageSchema,
  ])
  .meta({ id: "Message" });

const runSchema = z
  .object({
    id: z.uuid(),
    taskId: z.uuid().nullable(),
    startedAt: timeSchema,
    endedAt: timeSchema.nullable(),
    lastError: z.string().nullable(),
    failedAttempts: z.int().nonnegative(),
    messages: z.array(messageSchema),
  })
  .meta({ id: "Run" });

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const invalid = { 400: json(errorSchema, "The request doesn't fit the API; the message says why") };
// Every route can answer these. The OAuth resource server answers 401 before any handler runs.
const signedIn = {
  401: {
    description:
      "No token, or one not valid for /api (expired, revoked, or for another resource): sign in again. The body is empty without a token, and { error, error_description } (RFC 6750) with one.",
  },
  403: json(errorSchema, "The token names no user"),
  500: json(errorSchema, "Something went wrong on the server"),
};

/** Every route `/api` serves, with what each answers. */
export const routes = {
  listTasks: createRoute({
    operationId: "listTasks",
    method: "get",
    path: "/api/tasks",
    responses: {
      200: json(z.array(taskSchema), "The user's tasks, the next to run first"),
      ...signedIn,
    },
  }),
  addTask: createRoute({
    operationId: "addTask",
    method: "post",
    path: "/api/tasks",
    request: {
      body: {
        content: { "application/json": { schema: newTaskSchema.meta({ id: "NewTask" }) } },
        required: true,
      },
    },
    responses: {
      201: json(taskSchema, "The task added"),
      415: json(errorSchema, "The body isn't sent as application/json"),
      ...invalid,
      ...signedIn,
    },
  }),
  removeTask: createRoute({
    operationId: "removeTask",
    method: "delete",
    path: "/api/tasks/{taskId}",
    request: { params: z.object({ taskId: z.uuid() }) },
    responses: {
      204: { description: "Removed. Runs it already started carry on." },
      404: json(errorSchema, NO_SUCH_TASK),
      ...invalid,
      ...signedIn,
    },
  }),
  recentRuns: createRoute({
    operationId: "recentRuns",
    method: "get",
    path: "/api/runs",
    request: {
      query: z.object({
        limit: z.coerce.number().int().min(1).max(MAX_RECENT_RUNS).default(DEFAULT_RECENT_RUNS),
      }),
    },
    responses: {
      200: json(z.array(runSchema), "The user's latest runs first, each with its conversation"),
      ...invalid,
      ...signedIn,
    },
  }),
};

type Variables = { agent: ReturnType<Env["USER_AGENT"]["getByName"]> };

/**
 * `/api`: a signed-in user's tasks and runs, for requests the OAuth layer let through with
 * `UserProps`. A request without them is 403; one that doesn't fit the API is 400 with a message
 * saying why. Every answer with a body is JSON (a removal's 204 has none, nor does the OAuth
 * layer's 401 without a token), and none is cached.
 */
export const agentApi = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>({
  defaultHook: (result, c) =>
    result.success ? undefined : c.json({ message: z.prettifyError(result.error) }, 400),
});

agentApi.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  const props = userPropsSchema.safeParse(c.executionCtx.props);
  if (!props.success) {
    return c.json({ message: "Forbidden" }, 403);
  }
  c.set("agent", c.env.USER_AGENT.getByName(props.data.userId));
  return next();
});

agentApi.notFound((c) => c.json({ message: "Not found" }, 404));

// Hono rejects a body it can't read (malformed JSON, not JSON at all) by throwing; answer those
// as { message } like every other error, and anything unexpected as 500.
agentApi.onError((error, c) => {
  if (error instanceof HTTPException && error.status < 500) {
    return c.json({ message: error.message }, error.status);
  }
  console.error("/api failed.", error);
  return c.json({ message: "Something went wrong" }, 500);
});

function taskJson(task: Task): z.infer<typeof taskSchema> {
  return { ...task, nextRunAt: timeJson(task.nextRunAt) };
}

function runJson(run: Run): z.infer<typeof runSchema> {
  return {
    ...run,
    startedAt: timeJson(run.startedAt),
    endedAt: run.endedAt === null ? null : timeJson(run.endedAt),
  };
}

agentApi.openapi(routes.listTasks, async (c) => {
  const tasks = await c.var.agent.listTasks();
  return c.json(tasks.map(taskJson), 200);
});

agentApi.openapi(routes.addTask, async (c) => {
  const added = await c.var.agent.addTask(c.req.valid("json"));
  return added.ok ? c.json(taskJson(added.task), 201) : c.json({ message: added.error }, 400);
});

agentApi.openapi(routes.removeTask, async (c) => {
  const removed = await c.var.agent.removeTask(c.req.valid("param").taskId);
  return removed ? c.body(null, 204) : c.json({ message: NO_SUCH_TASK }, 404);
});

agentApi.openapi(routes.recentRuns, async (c) => {
  const runs = await c.var.agent.recentRuns(c.req.valid("query").limit);
  return c.json(runs.map(runJson), 200);
});

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
