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
      return { ok: true, content: shellReport(await shell.run(command)) };
    },
  });
}

/** What the model reads of a command's result. */
export function shellReport(result: ShellResult): string {
  const lines = [`exit code: ${result.exitCode}`];
  if (result.exitCode === 124 || result.exitCode === 137) {
    lines.push(`(stopped after ${COMMAND_TIMEOUT_SECONDS} seconds)`);
  }
  if (result.truncated) {
    lines.push("(output cut to its last 8 KB)");
  }
  lines.push("stdout:", result.stdout, "stderr:", result.stderr);
  return lines.join("\n");
}
