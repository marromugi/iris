import { z } from "zod";
import {
  assistantMessageSchema,
  type Message,
  type ToolCallPart,
  type ToolResultMessage,
  toolCalls,
} from "./message";
import type { Model, ModelProgress, ToolSpec } from "./model";
import type { Tool } from "./tool";

/** How many messages one `run` adds at most, so a model that keeps calling tools can't run forever. */
export const DEFAULT_MAX_STEPS = 50;

export interface Agent {
  readonly model: Model;
  readonly tools: readonly Tool[];
  readonly system?: string;
}

export interface RunOptions {
  readonly maxSteps?: number;
  /** Hears how the model is getting on with each message it writes, before the message is yielded. */
  readonly onProgress?: (progress: ModelProgress) => void;
}

export type NextAction =
  | { readonly type: "call-model" }
  | { readonly type: "run-tool"; readonly call: ToolCallPart }
  | { readonly type: "done" };

/**
 * What the conversation needs next: the next tool call still waiting for its result, the model's
 * answer, or nothing because the assistant has replied. Add a user message only when this is
 * `done`. Throws on a conversation the model can't be given: an empty one, a result that doesn't
 * answer the next waiting call, or another message while calls are still waiting.
 */
export function nextAction(messages: readonly Message[]): NextAction {
  const last = messages.at(-1);
  if (last === undefined) {
    throw new Error("The conversation is empty; it needs at least one message to act on.");
  }
  let waiting: readonly ToolCallPart[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role === "tool") {
      if (waiting[0]?.id !== message.callId) {
        throw new Error(
          `Message ${index} is a result for tool call "${message.callId}", but the next call waiting for a result is ${describe(waiting[0])}.`,
        );
      }
      waiting = waiting.slice(1);
      continue;
    }
    if (waiting[0] !== undefined) {
      throw new Error(
        `Message ${index} is a ${message.role} message, but tool call "${waiting[0].id}" is still waiting for its result.`,
      );
    }
    waiting = message.role === "assistant" ? toolCalls(message) : [];
  }
  if (waiting[0] !== undefined) {
    return { type: "run-tool", call: waiting[0] };
  }
  return last.role === "assistant" ? { type: "done" } : { type: "call-model" };
}

/**
 * Takes the conversation one step forward and returns the message that step adds: the model's
 * next message, or the result of one tool call. Returns undefined when the assistant has replied
 * and nothing is left to do. Rejects when the model does, when it returns a message that
 * `assistantMessageSchema` rejects, when a tool throws, when a tool's input schema can't be
 * turned into JSON Schema, when two tools share a name, and when `nextAction` throws.
 */
export async function step(
  agent: Agent,
  messages: readonly Message[],
  onProgress?: (progress: ModelProgress) => void,
): Promise<Message | undefined> {
  const tools = toolsByName(agent.tools);
  const action = nextAction(messages);
  if (action.type === "done") {
    return undefined;
  }
  if (action.type === "call-model") {
    const reply = await agent.model({
      system: agent.system,
      messages,
      tools: [...tools.values()].map(toolSpec),
      ...(onProgress === undefined ? {} : { onProgress }),
    });
    const parsed = assistantMessageSchema.safeParse(reply);
    if (!parsed.success) {
      throw new Error(`The model returned an invalid message:\n${z.prettifyError(parsed.error)}`, {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }
  return runToolCall(tools, action.call);
}

/**
 * Runs steps until the assistant replies without calling a tool, or until `maxSteps` messages
 * have been added, yielding each message as it is added. Save each message as it comes: a saved
 * conversation passed back in continues where it stopped, and `nextAction` on it tells whether
 * it finished.
 */
export async function* run(
  agent: Agent,
  messages: readonly Message[],
  options: RunOptions = {},
): AsyncGenerator<Message, void, undefined> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new RangeError(`maxSteps must be a whole number of at least 1, but is ${maxSteps}.`);
  }
  // Each step gets a new array, so a conversation already handed to the model never changes.
  let conversation = messages;
  for (let count = 0; count < maxSteps; count += 1) {
    const message = await step(agent, conversation, options.onProgress);
    if (message === undefined) {
      return;
    }
    conversation = [...conversation, message];
    yield message;
  }
}

function toolsByName(tools: readonly Tool[]): ReadonlyMap<string, Tool> {
  const byName = new Map<string, Tool>();
  for (const tool of tools) {
    if (byName.has(tool.name)) {
      throw new Error(`Two tools are named "${tool.name}"; the model could not tell them apart.`);
    }
    byName.set(tool.name, tool);
  }
  return byName;
}

function toolSpec(tool: Tool): ToolSpec {
  try {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.input, { io: "input" }),
    };
  } catch (error) {
    throw new Error(`The input schema of tool "${tool.name}" can't be turned into JSON Schema.`, {
      cause: error,
    });
  }
}

async function runToolCall(
  tools: ReadonlyMap<string, Tool>,
  call: ToolCallPart,
): Promise<ToolResultMessage> {
  const failed = (content: string): ToolResultMessage => ({
    role: "tool",
    callId: call.id,
    isError: true,
    content,
  });
  const tool = tools.get(call.name);
  if (tool === undefined) {
    return failed(`There is no tool named "${call.name}".`);
  }
  const parsed = await tool.input.safeParseAsync(call.input);
  if (!parsed.success) {
    return failed(`The input for "${call.name}" is invalid:\n${z.prettifyError(parsed.error)}`);
  }
  const outcome = await tool.run(parsed.data, { id: call.id });
  if (!outcome.ok) {
    return failed(outcome.error);
  }
  return { role: "tool", callId: call.id, isError: false, content: outcome.content };
}

function describe(call: ToolCallPart | undefined): string {
  return call === undefined ? "none" : `"${call.id}"`;
}
