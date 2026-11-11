import { S3Mount } from "@cloudflare/sandbox";
import { DurableObject } from "cloudflare:workers";
import { COMMAND_TIMEOUT_SECONDS, lastOutput, type ShellResult } from "./shell";

/** How long an agent's container keeps running after its last command, so the next one starts at once. */
export const IDLE_MS = 5 * 60 * 1000;

/** Where the agent's files live, kept in R2 under the agent's own prefix. */
export const WORKSPACE = "/workspace";

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
   * first when it isn't running. A command still going after `COMMAND_TIMEOUT_SECONDS` is stopped,
   * with exit code 124 (or 137 when it had to be killed).
   */
  async run(agentId: string, command: string): Promise<ShellResult> {
    await this.ready(agentId);
    const process = await this.container.exec(
      ["timeout", "--kill-after=5", String(COMMAND_TIMEOUT_SECONDS), "bash", "-lc", command],
      { cwd: WORKSPACE },
    );
    const output = await process.output();
    const stdout = lastOutput(new Uint8Array(output.stdout));
    const stderr = lastOutput(new Uint8Array(output.stderr));
    return {
      exitCode: output.exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      truncated: stdout.truncated || stderr.truncated,
    };
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
