import { z } from "zod";
import { type Message, type ToolCallPart, type ToolResult, toolCalls } from "./message";
import type { Model, ToolSpec } from "./model";
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
}

export type NextAction =
  | { readonly type: "call-model" }
  | { readonly type: "run-tools"; readonly calls: readonly ToolCallPart[] }
  | { readonly type: "done" };

/**
 * What the conversation needs next, read from its last message: the model's answer, the tool
 * calls it asked for, or nothing because the assistant has replied. Throws on an empty
 * conversation, which has nothing to act on.
 */
export function nextAction(messages: readonly Message[]): NextAction {
  const last = messages.at(-1);
  if (last === undefined) {
    throw new Error("The conversation is empty; it needs at least one message to act on.");
  }
  if (last.role !== "assistant") {
    return { type: "call-model" };
  }
  const calls = toolCalls(last);
  return calls.length > 0 ? { type: "run-tools", calls } : { type: "done" };
}

/**
 * Takes the conversation one step forward and returns the message that step adds, or undefined
 * when the assistant has replied and nothing is left to do. Rejects when the model does, or when
 * a tool throws.
 */
export async function step(
  agent: Agent,
  messages: readonly Message[],
): Promise<Message | undefined> {
  const tools = toolsByName(agent.tools);
  const action = nextAction(messages);
  if (action.type === "done") {
    return undefined;
  }
  if (action.type === "call-model") {
    return agent.model({
      system: agent.system,
      messages,
      tools: [...tools.values()].map(toolSpec),
    });
  }
  const results: ToolResult[] = [];
  for (const call of action.calls) {
    results.push(await runToolCall(tools, call));
  }
  return { role: "tool", results };
}

/**
 * Runs steps until the assistant replies without calling a tool, or until `maxSteps` messages
 * have been added, yielding each message as it is added. A saved conversation passed back in
 * continues where it stopped; `nextAction` on the result tells whether it finished.
 */
export async function* run(
  agent: Agent,
  messages: readonly Message[],
  options: RunOptions = {},
): AsyncGenerator<Message, void, undefined> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  // Each step gets a new array, so a conversation already handed to the model never changes.
  let conversation = messages;
  for (let count = 0; count < maxSteps; count += 1) {
    const message = await step(agent, conversation);
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
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input, { io: "input" }),
  };
}

async function runToolCall(
  tools: ReadonlyMap<string, Tool>,
  call: ToolCallPart,
): Promise<ToolResult> {
  const tool = tools.get(call.name);
  if (tool === undefined) {
    return { callId: call.id, isError: true, content: `There is no tool named "${call.name}".` };
  }
  const parsed = await tool.input.safeParseAsync(call.input);
  if (!parsed.success) {
    return {
      callId: call.id,
      isError: true,
      content: `The input for "${call.name}" is invalid:\n${z.prettifyError(parsed.error)}`,
    };
  }
  const outcome = await tool.run(parsed.data);
  return outcome.ok
    ? { callId: call.id, isError: false, content: outcome.content }
    : { callId: call.id, isError: true, content: outcome.error };
}
