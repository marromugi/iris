import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Which of the app's palettes the agent's orb is drawn in, taken modulo how many the app has. */
  lookPalette: integer("look_palette").notNull().default(0),
  /** What shapes the noise of the agent's orb. */
  lookSeed: integer("look_seed").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Where runs happen. `agentId` is set on an agent's own one-to-one thread, made with the agent;
 * `name` on a group; `consultRunId` on a consult, the run whose agent asked in it.
 */
export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").unique(),
    name: text("name"),
    consultRunId: text("consult_run_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("threads_consult_run_id").on(table.consultRunId)],
);

/** The agents in a thread: its own agent in a one-to-one thread, two or more in a group. */
export const threadMembers = sqliteTable(
  "thread_members",
  {
    threadId: text("thread_id").notNull(),
    agentId: text("agent_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.agentId] })],
);

/**
 * What was said in a thread: by the user, or in a consult by the agent that asked (`agentId`),
 * with the tool call it asked in (`callId`). Each reply to it is a run that carries its ID.
 */
export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    agentId: text("agent_id"),
    callId: text("call_id"),
    text: text("text").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("posts_thread_id").on(table.threadId)],
);

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  threadId: text("thread_id").notNull(),
  prompt: text("prompt").notNull(),
  cron: text("cron").notNull(),
  timeZone: text("time_zone").notNull(),
  nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }).notNull(),
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  threadId: text("thread_id").notNull(),
  taskId: text("task_id"),
  postId: text("post_id"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  dueAt: integer("due_at", { mode: "timestamp_ms" }).notNull(),
});

export const messages = sqliteTable(
  "messages",
  {
    runId: text("run_id").notNull(),
    seq: integer("seq").notNull(),
    format: integer("format").notNull(),
    body: text("body").notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.seq] })],
);

/** How many web searches the user's agents made in each month ("2026-11"). */
export const searchCounts = sqliteTable("search_counts", {
  month: text("month").primaryKey(),
  count: integer("count").notNull(),
});
