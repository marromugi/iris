import { S3Mount } from "@cloudflare/sandbox";
import { DurableObject } from "cloudflare:workers";
import { COMMAND_TIMEOUT_SECONDS, OutputTail, type ShellResult } from "./shell";

/** How long an agent's container keeps running after its last command, so the next one starts at once. */
export const IDLE_MS = 5 * 60 * 1000;

/** Where the agent's files live, kept in R2 under the agent's own prefix. */
export const WORKSPACE = "/workspace";

/**
 * How long after its time limit a command is killed outright, should `timeout` not end it: the
 * command's process is killed and what it wrote so far is kept.
 */
export const KILL_AFTER_MS = 10 * 1000;

/**
 * How long output is still read after the command ended. A process the command left running in the
 * background can keep the output open; what it writes after this is not read.
 */
export const OUTPUT_DRAIN_MS = 1000;

/**
 * One agent's sandbox: a Durable Object, named by the agent's ID, with a Linux container that has no
 * internet. Its `/workspace` is the agent's prefix in the R2 bucket, so files stay between runs
 * while the rest of the container starts fresh each time it starts. It stops `IDLE_MS` after its
 * last command.
 */
export class AgentSandbox extends DurableObject<Env> {
  private readonly mounts: S3Mount;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.mounts = new S3Mount(this.container, ctx.exports.S3Gateway);
    if (this.container.running) {
      // The timeout doesn't outlive the object; a restart sets it again.
      void ctx.blockConcurrencyWhile(() => this.container.setInactivityTimeout(IDLE_MS));
    }
  }

  /**
   * Runs `command` with bash in `/workspace`, starting the container and mounting the workspace
   * first when it isn't running. A command still going after `COMMAND_TIMEOUT_SECONDS` is stopped
   * by `timeout`, with exit code 124 (or 137 when it had to be killed), and killed outright
   * `KILL_AFTER_MS` later should that not work. Output is read as it comes, keeping only its end.
   */
  async run(agentId: string, command: string): Promise<ShellResult> {
    await this.ready(agentId);
    const killer = new AbortController();
    const process = await this.container.exec(
      ["timeout", "--kill-after=5", String(COMMAND_TIMEOUT_SECONDS), "bash", "-lc", command],
      { cwd: WORKSPACE, signal: killer.signal },
    );
    const stdout = new OutputTail();
    const stderr = new OutputTail();
    const readers = [read(process.stdout, stdout), read(process.stderr, stderr)];
    const killAt = setTimeout(() => killer.abort(), COMMAND_TIMEOUT_SECONDS * 1000 + KILL_AFTER_MS);
    try {
      const exitCode = await Promise.race([
        process.exitCode,
        new Promise<number>((resolve) => {
          killer.signal.addEventListener("abort", () => resolve(137));
        }),
      ]);
      await Promise.race([
        Promise.all(readers.map((reader) => reader.done)),
        new Promise((resolve) => setTimeout(resolve, OUTPUT_DRAIN_MS)),
      ]);
      const out = stdout.read();
      const err = stderr.read();
      return {
        exitCode,
        stdout: out.text,
        stderr: err.text,
        truncated: out.truncated || err.truncated,
      };
    } finally {
      clearTimeout(killAt);
      for (const reader of readers) {
        reader.stop();
      }
    }
  }

  private get container() {
    const container = this.ctx.container;
    if (container === undefined) {
      throw new Error("The sandbox has no container; wrangler.jsonc must give AgentSandbox one.");
    }
    return container;
  }

  private async ready(agentId: string): Promise<void> {
    if (!this.container.running) {
      this.container.start({ image: this.container.images.workspace, enableInternet: false });
      await this.container.setInactivityTimeout(IDLE_MS);
    }
    // Mounting again with the same settings reuses the mount.
    await this.mounts.mount({
      mountPath: WORKSPACE,
      source: {
        type: "s3",
        endpoint: this.env.S3_ENDPOINT,
        region: "auto",
        bucket: this.env.S3_BUCKET,
        credentials: {
          type: "static",
          accessKeyId: this.env.S3_ACCESS_KEY_ID,
          secretAccessKey: this.env.S3_SECRET_ACCESS_KEY,
        },
      },
      keyPrefix: `agents/${agentId}`,
      access: "read-write",
    });
  }
}

/** Reads the stream into `tail` until it ends or `stop()` is called. */
function read(
  stream: ReadableStream | null,
  tail: OutputTail,
): { done: Promise<void>; stop: () => void } {
  if (stream === null) {
    return { done: Promise.resolve(), stop: () => {} };
  }
  const reader = stream.getReader();
  const done = (async () => {
    try {
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        tail.push(new Uint8Array(chunk.value));
      }
    } catch {
      // Stopped, or the process went away; what came so far is kept.
    }
  })();
  return {
    done,
    stop: () => {
      reader.cancel().catch(() => {});
    },
  };
}
