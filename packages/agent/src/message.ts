import { z } from "zod";

export const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

/**
 * The model asking for one tool to run. `input` is any JSON value, so it survives being stored,
 * and is unchecked until the tool's own schema parses it.
 */
export const toolCallPartSchema = z.object({
  type: z.literal("tool-call"),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.json(),
});

export const userMessageSchema = z.object({
  role: z.literal("user"),
  text: z.string(),
});

export const assistantMessageSchema = z.object({
  role: z.literal("assistant"),
  parts: z.array(z.discriminatedUnion("type", [textPartSchema, toolCallPartSchema])),
});

/**
 * What came of one tool call. `isError` tells the model the call failed and `content` says why.
 * The results for an assistant message's tool calls follow it directly, one message per call,
 * in the order of the calls.
 */
export const toolResultMessageSchema = z.object({
  role: z.literal("tool"),
  callId: z.string().min(1),
  isError: z.boolean(),
  content: z.string(),
});

/**
 * One entry in a conversation. Parse stored or received messages with this before handing them
 * to the agent; how they must follow each other is checked by `nextAction`.
 */
export const messageSchema = z.discriminatedUnion("role", [
  userMessageSchema,
  assistantMessageSchema,
  toolResultMessageSchema,
]);

export type TextPart = z.infer<typeof textPartSchema>;
export type ToolCallPart = z.infer<typeof toolCallPartSchema>;
export type UserMessage = z.infer<typeof userMessageSchema>;
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export type ToolResultMessage = z.infer<typeof toolResultMessageSchema>;
export type Message = z.infer<typeof messageSchema>;

export function toolCalls(message: AssistantMessage): ToolCallPart[] {
  return message.parts.filter((part) => part.type === "tool-call");
}
