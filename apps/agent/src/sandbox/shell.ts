/** What a command run in an agent's sandbox gave back. Output past `MAX_OUTPUT_BYTES` keeps its end. */
export interface ShellResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Whether the start of stdout or stderr was cut. */
  readonly truncated: boolean;
}

/** Where an agent's commands run. Throws when the sandbox can't run them at all. */
export interface Shell {
  run(command: string): Promise<ShellResult>;
}

/** How long a command may run before it is stopped, in seconds. */
export const COMMAND_TIMEOUT_SECONDS = 60;

/** How much of each of stdout and stderr is kept, from the end, in bytes. */
export const MAX_OUTPUT_BYTES = 8 * 1024;

/**
 * The last `MAX_OUTPUT_BYTES` of a stream of output, kept as it comes, so output of any size takes
 * no more than that.
 */
export class OutputTail {
  private kept = new Uint8Array(0);
  private cut = false;

  push(chunk: Uint8Array): void {
    const joined = new Uint8Array(this.kept.length + chunk.length);
    joined.set(this.kept);
    joined.set(chunk, this.kept.length);
    if (joined.length > MAX_OUTPUT_BYTES) {
      this.cut = true;
      this.kept = joined.slice(joined.length - MAX_OUTPUT_BYTES);
    } else {
      this.kept = joined;
    }
  }

  /** The text kept, and whether anything before it was cut. */
  read(): { text: string; truncated: boolean } {
    return lastOutput(this.kept, this.cut);
  }
}

/**
 * The last `MAX_OUTPUT_BYTES` of the output as text, and whether anything before them was cut. A
 * cut never splits a character: bytes left over from one cut in two are dropped.
 */
export function lastOutput(
  bytes: Uint8Array,
  alreadyCut = false,
): { text: string; truncated: boolean } {
  const truncated = alreadyCut || bytes.length > MAX_OUTPUT_BYTES;
  let kept =
    bytes.length > MAX_OUTPUT_BYTES ? bytes.subarray(bytes.length - MAX_OUTPUT_BYTES) : bytes;
  if (truncated) {
    // UTF-8 bytes that continue a character start with 10.
    let start = 0;
    while (start < kept.length && start < 3 && ((kept[start] ?? 0) & 0b1100_0000) === 0b1000_0000) {
      start += 1;
    }
    kept = kept.subarray(start);
  }
  return { text: new TextDecoder().decode(kept), truncated };
}
