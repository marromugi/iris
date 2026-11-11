/** What a command run in an agent's sandbox gave back. Output past `MAX_OUTPUT_BYTES` keeps its end. */
export interface ShellResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Whether the start of stdout or stderr was cut. */
  readonly truncated: boolean;
}

/** Where an agent's commands run. */
export interface Shell {
  run(command: string): Promise<ShellResult>;
}

/** How long a command may run before it is stopped, in seconds. */
export const COMMAND_TIMEOUT_SECONDS = 60;

/** How much of each of stdout and stderr is kept, from the end, in bytes. */
export const MAX_OUTPUT_BYTES = 8 * 1024;

/** The last `MAX_OUTPUT_BYTES` of the output as text, and whether anything before them was cut. */
export function lastOutput(bytes: Uint8Array): { text: string; truncated: boolean } {
  const truncated = bytes.length > MAX_OUTPUT_BYTES;
  const kept = truncated ? bytes.subarray(bytes.length - MAX_OUTPUT_BYTES) : bytes;
  return { text: new TextDecoder().decode(kept), truncated };
}
