import { defineTool, type Tool } from "@iris/agent";
import { z } from "zod";
import { COMMAND_TIMEOUT_SECONDS, type Shell, type ShellResult } from "./shell";

/**
 * The tool with which an agent runs bash commands in its own sandbox: a Linux machine with no
 * internet, whose `/workspace` keeps the agent's files between runs.
 */
export function bashTool(shell: Shell): Tool {
  return defineTool({
    name: "bash",
    description: `Run a bash command in your own Linux sandbox and get its exit code and output. It starts in /workspace, where files you keep stay between runs; anything outside it is gone when the sandbox stops. There is no internet. Python 3, Node.js, jq and git are installed. A command is stopped after ${COMMAND_TIMEOUT_SECONDS} seconds, and only the last 8 KB of each output is shown.`,
    input: z.object({ command: z.string().min(1).describe("The bash command to run") }),
    async run({ command }) {
      try {
        return { ok: true, content: shellReport(await shell.run(command)) };
      } catch (error) {
        // The sandbox couldn't start, mount the workspace, or run anything: the model may go on without it.
        const reason = error instanceof Error ? error.message : String(error);
        return { ok: false, error: `The sandbox couldn't run the command: ${reason}` };
      }
    },
  });
}

/** What the model reads of a command's result. */
export function shellReport(result: ShellResult): string {
  const lines = [`exit code: ${result.exitCode}`];
  if (result.exitCode === 124) {
    lines.push(`(stopped after ${COMMAND_TIMEOUT_SECONDS} seconds)`);
  } else if (result.exitCode === 137) {
    lines.push(`(killed: it ran past ${COMMAND_TIMEOUT_SECONDS} seconds, or ran out of memory)`);
  }
  if (result.truncated) {
    lines.push("(output cut to its last 8 KB)");
  }
  lines.push("stdout:", result.stdout, "stderr:", result.stderr);
  return lines.join("\n");
}
