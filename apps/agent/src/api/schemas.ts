import { z } from "@hono/zod-openapi";
import {
  assistantMessageSchema,
  type Message,
  type reasoningPartSchema,
  type textPartSchema,
  type toolCallPartSchema,
  toolResultMessageSchema,
  userMessageSchema,
} from "@iris/agent";
import { lookSchema } from "../agent";
import type { MailState } from "../mail/setup";
import { scheduleSchema } from "../schedule";
import type { Agent, Post, Run, Task, Thread } from "../store";

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
    look: lookSchema,
    lastRanAt: timeSchema
      .nullable()
      .meta({ description: "When its latest run started; null until it first runs" }),
    active: z.boolean().meta({
      description:
        "False while it is deactivated: it replies to nothing and its tasks don't run, but everything it has stays",
    }),
  })
  .meta({ id: "Agent" });

export function agentJson(agent: Agent): z.infer<typeof agentSchema> {
  return {
    id: agent.id,
    name: agent.name,
    look: agent.look,
    lastRanAt: agent.lastRanAt === null ? null : timeJson(agent.lastRanAt),
    active: agent.active,
  };
}

export const threadSchema = z
  .object({
    id: z.uuid(),
    name: z.string().meta({
      description:
        "The group's name, the agent's in its one-to-one thread, or in a consult the agent asked",
    }),
    agentId: z.uuid().nullable().meta({
      description: "The agent whose one-to-one thread this is; null for a group or a consult",
    }),
    consultRunId: z.uuid().nullable().meta({
      description:
        "For a consult, the run whose agent asked in it; null otherwise. A consult is only for reading",
    }),
    agentIds: z
      .array(z.uuid())
      .meta({ description: "The members, in the order they were added as agents" }),
    lastActivityAt: timeSchema.meta({
      description: "When it was made, a post was sent, or a run started, whichever came last",
    }),
  })
  .meta({ id: "Thread" });

export function threadJson(thread: Thread): z.infer<typeof threadSchema> {
  return {
    id: thread.id,
    name: thread.name,
    agentId: thread.agentId,
    consultRunId: thread.consultRunId,
    agentIds: [...thread.agentIds],
    lastActivityAt: timeJson(thread.lastActivityAt),
  };
}

export const postSchema = z
  .object({
    id: z.uuid(),
    agentId: z
      .uuid()
      .nullable()
      .meta({ description: "The agent that asked it in a consult; null when the user said it" }),
    text: z.string(),
    createdAt: timeSchema,
  })
  .meta({
    id: "Post",
    description: "What was said in a thread: by the user, or in a consult by the agent that asked",
  });

export function postJson(post: Post): z.infer<typeof postSchema> {
  return {
    id: post.id,
    agentId: post.agentId,
    text: post.text,
    createdAt: timeJson(post.createdAt),
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

// An assistant message's part types as @iris/agent defines them. Typed as exactly these three, so
// a part type added there stops this from compiling until the API document says how to send it.
// Reasoning is the model's alone and is never sent.
const [textPart, toolCallPart]: readonly [
  typeof textPartSchema,
  typeof toolCallPartSchema,
  typeof reasoningPartSchema,
] = assistantMessageSchema.shape.parts.element.options;

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
    agentId: z.uuid().meta({ description: "The agent it is a run of" }),
    taskId: z
      .uuid()
      .nullable()
      .meta({ description: "The task that started it; null when a post did" }),
    postId: z.uuid().nullable().meta({
      description:
        "The post it replies to, which is also its first message; null when a task started it",
    }),
    startedAt: timeSchema,
    endedAt: timeSchema.nullable(),
    lastError: z.string().nullable(),
    failedAttempts: z.int().nonnegative(),
    messages: z.array(messageSchema),
    consults: z
      .array(
        z
          .object({
            callId: z.string().meta({ description: "The ask_agent tool call that asked" }),
            thread: threadSchema,
          })
          .meta({ id: "Consult" }),
      )
      .meta({ description: "The consults its agent asked in, the first asked first" }),
  })
  .meta({ id: "Run" });

export function runJson(run: Run): z.infer<typeof runSchema> {
  return {
    id: run.id,
    agentId: run.agentId,
    taskId: run.taskId,
    postId: run.postId,
    startedAt: timeJson(run.startedAt),
    endedAt: run.endedAt === null ? null : timeJson(run.endedAt),
    lastError: run.lastError,
    failedAttempts: run.failedAttempts,
    messages: run.messages.map(messageJson),
    consults: run.consults.map(({ callId, thread }) => ({ callId, thread: threadJson(thread) })),
  };
}

function messageJson(message: Message): z.infer<typeof messageSchema> {
  return message.role === "assistant"
    ? { ...message, parts: message.parts.filter((part) => part.type !== "reasoning") }
    : message;
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

export const threadEntrySchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("post"), post: postSchema }),
    z.object({ type: z.literal("run"), run: runSchema }),
  ])
  .meta({ id: "ThreadEntry", description: "A post or a run of a thread" });

export const runEventSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("run"), run: runSchema }).meta({
      description:
        "A run started, got a message, or ended or failed an attempt: the run as it is now",
    }),
    z.object({ type: z.literal("progress"), runId: z.uuid(), progress: runProgressSchema }).meta({
      description: `How a run being carried on is getting on. A socket that opens during a run hears the latest at once. Writing comes at most every ${WRITING_EVERY_MS} ms; the run's next run event has the whole message.`,
    }),
    z.object({ type: z.literal("post"), post: postSchema }).meta({
      description:
        "A post was sent in the thread. Only a socket opened at /api/threads/{threadId}/events hears these; the runs that reply to it follow as run events",
    }),
  ])
  .meta({
    id: "RunEvent",
    description:
      "One event on the WebSocket at /api/threads/{threadId}/events, or at /api/agents/{agentId}/events for the agent's one-to-one thread without posts, which the app opens with the same token as /api. The server sends these as JSON text; the app sends nothing. Nothing is sent about what happened before the socket opened, apart from the progress of a run being carried on: open the socket, then read the runs.",
  });

export type RunEvent = z.infer<typeof runEventSchema>;

export const userEventSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("mail") }).meta({
      description:
        "The user's mail setup changed: an address was made or let go, Gmail's forwarding confirmation arrived or was let go, or mail arrived. Read /api/me/mail again",
    }),
  ])
  .meta({
    id: "UserEvent",
    description:
      "One event on the WebSocket at /api/me/events, which the app opens with the same token as /api while it is in the foreground. The server sends these as JSON text; the app sends nothing. Nothing is sent about what happened before the socket opened: open the socket, then read what it is about.",
  });

export type UserEvent = z.infer<typeof userEventSchema>;

export const mailSetupSchema = z
  .object({
    address: z.email().nullable().meta({
      description: "Where the user forwards mail for their agents to read; null until one is made",
    }),
    confirmation: z
      .object({
        url: z.url().meta({
          description:
            "The link that confirms the address to Gmail. Forwarding is then turned on in Gmail's settings",
        }),
        code: z
          .string()
          .nullable()
          .meta({ description: "The code that confirms it in Gmail's settings instead, if any" }),
        receivedAt: timeSchema,
      })
      .nullable()
      .meta({
        description:
          "Gmail's forwarding confirmation for the address, from when it arrives until mail arrives after it or the app lets it go; null otherwise",
      }),
    lastMailAt: timeSchema.nullable().meta({
      description:
        "When mail other than Gmail's confirmation last arrived at the address; null until the first does",
    }),
  })
  .meta({ id: "MailSetup", description: "Where the user's mail setup stands" });

export type MailSetupJson = z.infer<typeof mailSetupSchema>;

/** The mail setup as `/api` sends it: the user's address, and where its setup stands. */
export function mailSetupJson(address: string | null, state: MailState): MailSetupJson {
  return {
    address,
    confirmation:
      state.confirmation === null
        ? null
        : {
            url: state.confirmation.url,
            code: state.confirmation.code,
            receivedAt: timeJson(state.confirmation.receivedAt),
          },
    lastMailAt: state.lastMailAt === null ? null : timeJson(state.lastMailAt),
  };
}
