import type { z } from "zod";
import type { AssistantMessage, Message } from "./message";

/** A tool as the model sees it: its name, what it does, and the JSON Schema its input must match. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.core.JSONSchema.BaseSchema;
}

export interface ModelRequest {
  readonly system: string | undefined;
  readonly messages: readonly Message[];
  readonly tools: readonly ToolSpec[];
}

/**
 * Produces the assistant's next message for a conversation. An adapter for one model service
 * implements this and keeps that service's message format to itself. It rejects when the
 * service fails, and the agent passes that rejection on to its caller.
 */
export type Model = (request: ModelRequest) => Promise<AssistantMessage>;
