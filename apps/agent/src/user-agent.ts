import type { Agent } from "@iris/agent";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { type NewAgent, newAgentSchema } from "./agent";
import { type NewMessage, newMessageSchema } from "./message";
import { RunBroadcast } from "./run-broadcast";
import { nextWakeAt, runNext } from "./runner";
import { DEFAULT_RECENT_RUNS } from "./runs";
import { nextRunAt } from "./schedule";
import * as store from "./store";
import { type NewTask, newTaskSchema } from "./task";

export type AddAgentResult =
  | { readonly ok: true; readonly agent: store.Agent }
  | { readonly ok: false; readonly error: string };

export type AddTaskResult =
  | { readonly ok: true; readonly task: store.Task }
  | { readonly ok: false; readonly error: string };

export type SendMessageResult =
  | { readonly ok: true; readonly run: store.Run }
  | { readonly ok: false; readonly error: string };

/**
 * Builds the Durable Object class for one user. One object per user holds that user's agents,
 * and each agent's tasks and runs; `agentFor` gives the model and tools every run uses. Its
 * `fetch` opens a WebSocket on which an agent's runs are sent as they happen (`RunBroadcast`).
 *
 * The methods that take an agent's ID answer undefined when the user has no agent with it.
 */
export function createUserAgent(agentFor: (env: Env) => Agent) {
  return class UserAgent extends DurableObject<Env> {
    private readonly broadcast: RunBroadcast;

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      store.migrate(ctx.storage);
      this.broadcast = new RunBroadcast(ctx);
    }

    /**
     * Opens the WebSocket for the events of the agent named by the `agentId` search parameter:
     * 101 with the socket, 404 when the user has no such agent, 426 for a request that isn't a
     * WebSocket upgrade.
     */
    override async fetch(request: Request): Promise<Response> {
      const agentId = new URL(request.url).searchParams.get("agentId");
      if (agentId === null || !store.hasAgent(this.ctx.storage, agentId)) {
        return new Response(null, { status: 404 });
      }
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response(null, { status: 426 });
      }
      const { 0: client, 1: server } = new WebSocketPair();
      this.broadcast.accept(agentId, server);
      return new Response(null, { status: 101, webSocket: client });
    }

    /** The app sends nothing on its socket; whatever comes is let go. */
    override webSocketMessage(): void {}

    override webSocketClose(socket: WebSocket, code: number, reason: string): void {
      try {
        // 1005 and 1006 say no code came; they can't be sent back.
        socket.close(code === 1005 || code === 1006 ? 1000 : code, reason);
      } catch {
        // Already closed.
      }
    }

    /** The user's agents in the order they were added. */
    listAgents(): store.Agent[] {
      return store.listAgents(this.ctx.storage);
    }

    /** Adds an agent with its own one-to-one thread. An invalid name comes back as `ok: false`. */
    addAgent(input: NewAgent): AddAgentResult {
      const parsed = newAgentSchema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, error: z.prettifyError(parsed.error) };
      }
      const agent = { id: crypto.randomUUID(), name: parsed.data.name, createdAt: new Date() };
      store.insertAgent(this.ctx.storage, agent);
      return { ok: true, agent: { id: agent.id, name: agent.name, lastRanAt: null } };
    }

    /** Adds a task the agent runs `prompt` on `schedule`. An invalid prompt or schedule comes back as `ok: false`. */
    async addTask(agentId: string, input: NewTask): Promise<AddTaskResult | undefined> {
      const threadId = store.agentThreadId(this.ctx.storage, agentId);
      if (threadId === undefined) {
        return undefined;
      }
      const parsed = newTaskSchema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, error: z.prettifyError(parsed.error) };
      }
      const now = new Date();
      const task: store.Task = {
        id: crypto.randomUUID(),
        agentId,
        threadId,
        prompt: parsed.data.prompt,
        schedule: parsed.data.schedule,
        nextRunAt: nextRunAt(parsed.data.schedule, now),
      };
      store.insertTask(this.ctx.storage, task);
      await this.wakeAt(nextWakeAt(this.ctx.storage));
      return { ok: true, task };
    }

    /** Removes one of the agent's tasks and says whether it had one. Runs it already started carry on. */
    async removeTask(agentId: string, taskId: string): Promise<boolean | undefined> {
      if (!store.hasAgent(this.ctx.storage, agentId)) {
        return undefined;
      }
      const removed = store.deleteTask(this.ctx.storage, agentId, taskId);
      await this.wakeAt(nextWakeAt(this.ctx.storage));
      return removed;
    }

    /**
     * Starts a run of the agent in its one-to-one thread on a message the user sent, which the
     * alarm carries on once the thread's earlier runs have ended, and returns the run as it
     * starts. Empty text comes back as `ok: false`.
     */
    async sendMessage(agentId: string, input: NewMessage): Promise<SendMessageResult | undefined> {
      const threadId = store.agentThreadId(this.ctx.storage, agentId);
      if (threadId === undefined) {
        return undefined;
      }
      const parsed = newMessageSchema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, error: z.prettifyError(parsed.error) };
      }
      const id = crypto.randomUUID();
      store.startRun(this.ctx.storage, {
        id,
        agentId,
        threadId,
        text: parsed.data.text,
        startedAt: new Date(),
      });
      const run = store.findRun(this.ctx.storage, id);
      if (run === undefined) {
        throw new Error(`Run ${id} was started but isn't stored.`);
      }
      this.broadcast.changed(id);
      await this.wakeAt(nextWakeAt(this.ctx.storage));
      return { ok: true, run };
    }

    /** The agent's tasks, the next to run first. */
    listTasks(agentId: string): store.Task[] | undefined {
      if (!store.hasAgent(this.ctx.storage, agentId)) {
        return undefined;
      }
      return store.listTasks(this.ctx.storage, agentId);
    }

    /** The agent's latest runs first, at most `limit` of them, each with its conversation. */
    recentRuns(agentId: string, limit = DEFAULT_RECENT_RUNS): store.Run[] | undefined {
      if (!store.hasAgent(this.ctx.storage, agentId)) {
        return undefined;
      }
      return store.recentRuns(this.ctx.storage, agentId, limit);
    }

    override async alarm(): Promise<void> {
      try {
        const wakeAt = await runNext(
          this.ctx.storage,
          agentFor(this.env),
          () => new Date(),
          this.broadcast,
        );
        await this.wakeAt(wakeAt);
      } finally {
        this.broadcast.idle();
      }
    }

    private async wakeAt(time: Date | undefined): Promise<void> {
      if (time === undefined) {
        await this.ctx.storage.deleteAlarm();
      } else {
        await this.ctx.storage.setAlarm(time);
      }
    }
  };
}
