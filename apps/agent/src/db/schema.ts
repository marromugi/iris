import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Where runs happen. `agentId` is set on an agent's own one-to-one thread, made with the agent. */
export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

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
