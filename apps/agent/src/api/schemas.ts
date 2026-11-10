import { z } from "@hono/zod-openapi";
import {
  assistantMessageSchema,
  type textPartSchema,
  type toolCallPartSchema,
  toolResultMessageSchema,
  userMessageSchema,
} from "@iris/agent";
import { scheduleSchema } from "../schedule";
import type { Agent, Run, Task } from "../store";

/** A response body in JSON with the given schema. */
export function json<S extends z.ZodType>(schema: S, description: string) {
  return { content: { "application/json": { schema } }, description };
}

// Whole seconds: clients' default ISO 8601 parsers (Swift's among them) reject fractional seconds.
const timeSchema = z.iso.datetime({ precision: 0 });

function timeJson(time: Date): string {
  return time.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export const agentSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    lastRanAt: timeSchema
      .nullable()
      .meta({ description: "When its latest run started; null until it first runs" }),
  })
  .meta({ id: "Agent" });

export function agentJson(agent: Agent): z.infer<typeof agentSchema> {
  return {
    id: agent.id,
    name: agent.name,
    lastRanAt: agent.lastRanAt === null ? null : timeJson(agent.lastRanAt),
  };
}

export const taskSchema = z
  .object({
    id: z.uuid(),
    prompt: z.string(),
    schedule: scheduleSchema,
    nextRunAt: timeSchema,
  })
  .meta({ id: "Task" });

export function taskJson(task: Task): z.infer<typeof taskSchema> {
  return {
    id: task.id,
    prompt: task.prompt,
    schedule: task.schedule,
    nextRunAt: timeJson(task.nextRunAt),
  };
}

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

export const runSchema = z
  .object({
    id: z.uuid(),
    taskId: z
      .uuid()
      .nullable()
      .meta({ description: "The task that started it; null when a message sent to the agent did" }),
    startedAt: timeSchema,
    endedAt: timeSchema.nullable(),
    lastError: z.string().nullable(),
    failedAttempts: z.int().nonnegative(),
    messages: z.array(messageSchema),
  })
  .meta({ id: "Run" });

export function runJson(run: Run): z.infer<typeof runSchema> {
  return {
    id: run.id,
    taskId: run.taskId,
    startedAt: timeJson(run.startedAt),
    endedAt: run.endedAt === null ? null : timeJson(run.endedAt),
    lastError: run.lastError,
    failedAttempts: run.failedAttempts,
    messages: run.messages,
  };
}

/**
 * How often a run's writing goes out at most. Writing that comes sooner waits for the rest of the
 * interval, and then the latest goes out, unless the run's next `run` event, which has the whole
 * message, comes first.
 */
export const WRITING_EVERY_MS = 100;

const runProgressSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("starting") }).meta({ description: "The run was picked up" }),
    z
      .object({ type: z.literal("thinking") })
      .meta({ description: "The model is asked, and hasn't written anything of this message yet" }),
    z
      .object({ type: z.literal("writing"), text: z.string() })
      .meta({ description: "The model is writing; text is the message so far" }),
  ])
  .meta({ id: "RunProgress" });

export const runEventSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("run"), run: runSchema }).meta({
      description:
        "A run started, got a message, or ended or failed an attempt: the run as it is now",
    }),
    z.object({ type: z.literal("progress"), runId: z.uuid(), progress: runProgressSchema }).meta({
      description: `How a run being carried on is getting on. A socket that opens during a run hears the latest at once. Writing comes at most every ${WRITING_EVERY_MS} ms; the run's next run event has the whole message.`,
    }),
  ])
  .meta({
    id: "RunEvent",
    description:
      "One event on the WebSocket at /api/agents/{agentId}/events, which the app opens with the same token as /api. The server sends these as JSON text; the app sends nothing. Nothing is sent about what happened before the socket opened, apart from the progress of a run being carried on: open the socket, then read the runs.",
  });

export type RunEvent = z.infer<typeof runEventSchema>;
