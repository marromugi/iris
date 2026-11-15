import { type Message, messageSchema } from "@iris/agent";
import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { messages, runs } from "../db/schema";
import { database } from "./database";

/** The format messages are stored in. A stored message in any other format is refused, not guessed at. */
const MESSAGE_FORMAT = 1;

export function messageRow(
  runId: string,
  seq: number,
  message: Message,
): typeof messages.$inferInsert {
  return { runId, seq, format: MESSAGE_FORMAT, body: JSON.stringify(message) };
}

export function appendMessage(
  storage: DurableObjectStorage,
  runId: string,
  seq: number,
  message: Message,
): void {
  database(storage)
    .insert(messages)
    .values(messageRow(runId, seq, message))
    .run();
}

export function loadConversation(storage: DurableObjectStorage, runId: string): Message[] {
  return database(storage)
    .select()
    .from(messages)
    .where(eq(messages.runId, runId))
    .orderBy(asc(messages.seq))
    .all()
    .map((row) => {
      if (row.format !== MESSAGE_FORMAT) {
        throw new Error(
          `Message ${row.seq} of run ${runId} is stored in format ${row.format}; this code reads only ${MESSAGE_FORMAT}.`,
        );
      }
      return messageSchema.parse(JSON.parse(row.body));
    });
}

export const earlierRuns = alias(runs, "earlier_runs");

/**
 * A message of an earlier run as a later run reads it. The model's reasoning stays with the run
 * that produced it: it was written against that run's view of the thread, not the later one's.
 */
export function withoutReasoning(message: Message): Message {
  return message.role === "assistant"
    ? { ...message, parts: message.parts.filter((part) => part.type !== "reasoning") }
    : message;
}

/** The text of a finished conversation's last message. */
export function replyText(conversation: readonly Message[]): string {
  const last = conversation.at(-1);
  return last?.role === "assistant"
    ? last.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
    : "";
}
