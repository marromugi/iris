import { z } from "zod";

export const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

/** The model asking for one tool to run. `input` is unchecked until the tool's own schema parses it. */
export const toolCallPartSchema = z.object({
  type: z.literal("tool-call"),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
});

export const userMessageSchema = z.object({
  role: z.literal("user"),
  text: z.string(),
});

export const assistantMessageSchema = z.object({
  role: z.literal("assistant"),
  parts: z.array(z.discriminatedUnion("type", [textPartSchema, toolCallPartSchema])),
});

/** What came of one tool call. `isError` tells the model the call failed and `content` says why. */
export const toolResultSchema = z.object({
  callId: z.string().min(1),
  isError: z.boolean(),
  content: z.string(),
});

/** The results of every tool call in the assistant message before it, in the same order. */
export const toolResultsMessageSchema = z.object({
  role: z.literal("tool"),
  results: z.array(toolResultSchema),
});

/** One entry in a conversation. Parse stored or received conversations with this before handing them to the agent. */
export const messageSchema = z.discriminatedUnion("role", [
  userMessageSchema,
  assistantMessageSchema,
  toolResultsMessageSchema,
]);

export type TextPart = z.infer<typeof textPartSchema>;
export type ToolCallPart = z.infer<typeof toolCallPartSchema>;
export type UserMessage = z.infer<typeof userMessageSchema>;
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export type ToolResult = z.infer<typeof toolResultSchema>;
export type ToolResultsMessage = z.infer<typeof toolResultsMessageSchema>;
export type Message = z.infer<typeof messageSchema>;

export function toolCalls(message: AssistantMessage): ToolCallPart[] {
  return message.parts.filter((part) => part.type === "tool-call");
}
