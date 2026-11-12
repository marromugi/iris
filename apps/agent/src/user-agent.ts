import type { Agent } from "@iris/agent";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { type NewAgent, newAgentSchema, randomLook } from "./agent";
import { type NewGroup, newGroupSchema } from "./group";
import { repliers } from "./mentions";
import { type NewMessage, newMessageSchema } from "./message";
import { RunBroadcast } from "./run-broadcast";
import { summarizeDue } from "./daily-summary";
import { nextWakeAt, type RunOf, type RunTools, runDue, WAKE_UP_BUDGET_MS, Waker } from "./runner";
import { DEFAULT_RECENT_RUNS } from "./runs";
import { nextRunAt, timeZoneSchema } from "./schedule";
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

export type AddGroupResult =
  | { readonly ok: true; readonly thread: store.Thread }
  | { readonly ok: false; readonly error: string };

export type PostResult =
  | { readonly ok: true; readonly post: store.Post; readonly runs: store.Run[] }
  | { readonly ok: false; readonly error: string };

export type ThreadEntry = ReturnType<typeof store.threadEntries>[number];

/** The real time, for the alarm's work. */
const clock = () => new Date();

/**
 * Builds the Durable Object class for one user. One object per user holds that user's agents and
 * threads (each agent's own one-to-one thread, and groups), the posts sent in them, and the tasks
 * and runs that happen in them, with the user's time zone and each thread's summary of each day;
 * `agentFor` gives the model and tools every run uses, and `toolsFor`
 * the tools a run gets for its own agent, such as its sandbox, its browser, and web search. Its `fetch`
 * opens a WebSocket on which a thread's runs and posts are sent as they happen (`RunBroadcast`).
 *
 * The methods that take an agent's or a thread's ID answer undefined when the user has none with
 * it. A method on an agent works on the agent's own one-to-one thread.
 */
export function createUserAgent(
  agentFor: (env: Env) => Agent,
  toolsFor: (env: Env, run: RunOf, storage: DurableObjectStorage) => RunTools = () => ({
    tools: [],
  }),
) {
  return class UserAgent extends DurableObject<Env> {
    private readonly broadcast: RunBroadcast;
    /** Wakes the alarm's wake-up, while one carries runs on, to start work that just became due. */
    private readonly waker = new Waker();

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      store.migrate(ctx.storage);
      this.broadcast = new RunBroadcast(ctx);
    }

    /**
     * Opens the WebSocket for the events of the thread named by the `threadId` search parameter,
     * which hears runs and posts, or of the one-to-one thread of the agent named by `agentId`,
     * which hears runs only: 101 with the socket, 404 when the user has no such thread or agent,
     * 426 for a request that isn't a WebSocket upgrade.
     */
    override async fetch(request: Request): Promise<Response> {
      const params = new URL(request.url).searchParams;
      const opened = this.socketThread(params.get("threadId"), params.get("agentId"));
      if (opened === undefined) {
        return new Response(null, { status: 404 });
      }
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response(null, { status: 426 });
      }
      const { 0: client, 1: server } = new WebSocketPair();
      this.broadcast.accept(opened.threadId, server, opened.hears);
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

    /** The user's threads, the latest activity first. */
    listThreads(): store.Thread[] {
      return store.listThreads(this.ctx.storage);
    }

    /**
     * Makes a group of two or more of the user's agents. An invalid name, too few agents, or an
     * agent the user doesn't have comes back as `ok: false`.
     */
    addGroup(input: NewGroup): AddGroupResult {
      const parsed = newGroupSchema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, error: z.prettifyError(parsed.error) };
      }
      const known = store.knownAgents(this.ctx.storage, parsed.data.agentIds);
      const unknown = parsed.data.agentIds.filter((id) => !known.includes(id));
      if (unknown.length > 0) {
        return { ok: false, error: `The user has no agent ${unknown.join(", ")}` };
      }
      const id = crypto.randomUUID();
      store.insertGroup(this.ctx.storage, {
        id,
        name: parsed.data.name,
        agentIds: parsed.data.agentIds,
        createdAt: new Date(),
      });
      const thread = store.findThread(this.ctx.storage, id);
      if (thread === undefined) {
        throw new Error(`Group ${id} was added but isn't stored.`);
      }
      return { ok: true, thread };
    }

    /**
     * Sends a post in the thread, and starts a run of each member that replies to it: those
     * named with @, or every member when none is. Returns the post and its runs as they start.
     * Empty text comes back as `ok: false`.
     */
    async post(threadId: string, input: NewMessage): Promise<PostResult | undefined> {
      const thread = store.findThread(this.ctx.storage, threadId);
      if (thread === undefined) {
        return undefined;
      }
      if (thread.consultRunId !== null) {
        return { ok: false, error: "A consult is only for reading; agents ask and answer in it." };
      }
      const parsed = newMessageSchema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, error: z.prettifyError(parsed.error) };
      }
      const names = new Map(
        store.listAgents(this.ctx.storage).map((agent) => [agent.id, agent.name]),
      );
      const members = thread.agentIds.map((id) => ({ id, name: names.get(id) ?? "" }));
      return {
        ok: true,
        ...(await this.startPost(threadId, parsed.data.text, repliers(parsed.data.text, members))),
      };
    }

    /** The thread's latest posts and runs together, the latest first, at most `limit` of them. */
    threadEntries(threadId: string, limit: number): ThreadEntry[] | undefined {
      if (store.findThread(this.ctx.storage, threadId) === undefined) {
        return undefined;
      }
      return store.threadEntries(this.ctx.storage, threadId, limit);
    }

    /** Adds an agent with its own one-to-one thread. An invalid name comes back as `ok: false`. */
    addAgent(input: NewAgent): AddAgentResult {
      const parsed = newAgentSchema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, error: z.prettifyError(parsed.error) };
      }
      const agent = {
        id: crypto.randomUUID(),
        name: parsed.data.name,
        look: parsed.data.look ?? randomLook(),
        createdAt: new Date(),
      };
      store.insertAgent(this.ctx.storage, agent);
      return {
        ok: true,
        agent: { id: agent.id, name: agent.name, look: agent.look, lastRanAt: null },
      };
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
     * Sends a post in the agent's one-to-one thread and starts the agent's run that replies to
     * it, which the alarm carries on once the thread's earlier runs have ended, and returns the
     * run as it starts. Empty text comes back as `ok: false`.
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
      const { runs } = await this.startPost(threadId, parsed.data.text, [agentId]);
      const [run] = runs;
      if (run === undefined) {
        throw new Error(`The post to agent ${agentId} started no run.`);
      }
      return { ok: true, run };
    }

    /**
     * Sets the time zone the user's days are read in, from their device, and when the next
     * summary is due with it. An unknown time zone comes back as `ok: false`.
     */
    async setTimeZone(timeZone: string): Promise<{ ok: true } | { ok: false; error: string }> {
      const parsed = timeZoneSchema.safeParse(timeZone);
      if (!parsed.success) {
        return { ok: false, error: z.prettifyError(parsed.error) };
      }
      store.setTimeZone(this.ctx.storage, parsed.data);
      await this.wakeAt(nextWakeAt(this.ctx.storage));
      return { ok: true };
    }

    /** The agent's tasks, the next to run first. */
    listTasks(agentId: string): store.Task[] | undefined {
      if (!store.hasAgent(this.ctx.storage, agentId)) {
        return undefined;
      }
      return store.listTasks(this.ctx.storage, agentId);
    }

    /**
     * The latest runs of the agent's one-to-one thread first, at most `limit` of them, each with
     * its conversation.
     */
    recentRuns(agentId: string, limit = DEFAULT_RECENT_RUNS): store.Run[] | undefined {
      const threadId = store.agentThreadId(this.ctx.storage, agentId);
      if (threadId === undefined) {
        return undefined;
      }
      return store.recentRuns(this.ctx.storage, threadId, limit);
    }

    /** Carries on the work that is due and writes the summaries that are, side by side. */
    override async alarm(): Promise<void> {
      try {
        const agent = agentFor(this.env);
        const stopAt = clock().getTime() + WAKE_UP_BUDGET_MS;
        const summarizing = summarizeDue(
          this.ctx.storage,
          agent.model,
          clock,
          () => clock().getTime() >= stopAt,
        );
        const wakeAt = await runDue(
          this.ctx.storage,
          agent,
          clock,
          this.broadcast,
          this.waker,
          (run) => toolsFor(this.env, run, this.ctx.storage),
          summarizing,
        );
        await summarizing;
        await this.wakeAt(wakeAt);
      } finally {
        this.broadcast.idle();
      }
    }

    /** The thread a socket is opened on, and what it hears; undefined when the user has no such thread or agent. */
    private socketThread(
      threadId: string | null,
      agentId: string | null,
    ): { threadId: string; hears: "runs" | "runs-and-posts" } | undefined {
      if (threadId !== null) {
        return store.findThread(this.ctx.storage, threadId) === undefined
          ? undefined
          : { threadId, hears: "runs-and-posts" };
      }
      const agentThreadId =
        agentId === null ? undefined : store.agentThreadId(this.ctx.storage, agentId);
      return agentThreadId === undefined ? undefined : { threadId: agentThreadId, hears: "runs" };
    }

    /** Adds the post with a run of each of `agentIds` replying to it, tells the sockets, and sets the alarm. */
    private async startPost(
      threadId: string,
      text: string,
      agentIds: readonly string[],
    ): Promise<{ post: store.Post; runs: store.Run[] }> {
      const post: store.Post = {
        id: crypto.randomUUID(),
        threadId,
        agentId: null,
        callId: null,
        text,
        createdAt: new Date(),
      };
      const runIds = store.insertPost(this.ctx.storage, post, agentIds);
      this.broadcast.posted(post);
      const runs = runIds.map((id) => {
        const run = store.findRun(this.ctx.storage, id);
        if (run === undefined) {
          throw new Error(`Run ${id} was started but isn't stored.`);
        }
        this.broadcast.changed(id);
        return run;
      });
      await this.wakeAt(nextWakeAt(this.ctx.storage));
      return { post, runs };
    }

    /** Sets the alarm for `time`, and tells a wake-up going on that work may be due. */
    private async wakeAt(time: Date | undefined): Promise<void> {
      this.waker.wake();
      if (time === undefined) {
        await this.ctx.storage.deleteAlarm();
      } else {
        await this.ctx.storage.setAlarm(time);
      }
    }
  };
}
