import type { z } from "zod";
import type { AssistantMessage, Message } from "./message";

/** A tool as the model sees it: its name, what it does, and the JSON Schema its input must match. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.core.JSONSchema.BaseSchema;
}

/**
 * How the model is getting on with its next message before the message is whole: thinking, or
 * writing, with the text written so far.
 */
export type ModelProgress =
  | { readonly type: "thinking" }
  | { readonly type: "writing"; readonly text: string };

export interface ModelRequest {
  readonly system: string | undefined;
  readonly messages: readonly Message[];
  readonly tools: readonly ToolSpec[];
  /** Called as the model works on the message, by a model that can say. */
  readonly onProgress?: (progress: ModelProgress) => void;
}

/**
 * Produces the assistant's next message for a conversation. An adapter for one model service
 * implements this and keeps that service's message format to itself, except inside the reasoning
 * parts it writes, which only it reads. It rejects when the service fails, and the agent passes
 * that rejection on to its caller.
 */
export type Model = (request: ModelRequest) => Promise<AssistantMessage>;
