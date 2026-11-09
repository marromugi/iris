import type { z } from "zod";

/**
 * What a tool hands back. `ok: false` is a failure the model should see and may work around,
 * such as a city that doesn't exist or a service that can't be reached. A thrown error is a bug
 * in the tool and stops the run.
 */
export type ToolOutcome = { ok: true; content: string } | { ok: false; error: string };

/**
 * A tool the model can call. `input` parses the model's arguments before `run` sees them.
 * A call's result is saved only after `run` returns, so if the process stops while `run` is
 * working, the same call runs again when the conversation is resumed.
 */
export interface Tool<Input extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly input: Input;
  run(input: z.output<Input>): Promise<ToolOutcome>;
}

/** Builds a tool, typing `run`'s argument from the `input` schema. */
export function defineTool<Input extends z.ZodType>(tool: Tool<Input>): Tool<Input> {
  return tool;
}
