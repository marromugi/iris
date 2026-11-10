import type { Agent } from "@iris/agent";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { nextWakeAt, runNext } from "./runner";
import { DEFAULT_RECENT_RUNS } from "./runs";
import { nextRunAt } from "./schedule";
import * as store from "./store";
import { type NewTask, newTaskSchema } from "./task";

export type AddTaskResult =
  | { readonly ok: true; readonly task: store.Task }
  | { readonly ok: false; readonly error: string };

/**
 * Builds the Durable Object class for one user. One object per user holds that user's agents,
 * and each agent's tasks and runs; `agentFor` gives the model and tools every run uses.
 *
 * The methods that take an agent's ID answer undefined when the user has no agent with it.
 */
export function createUserAgent(agentFor: (env: Env) => Agent) {
  return class UserAgent extends DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      store.migrate(ctx.storage);
    }

    /** The user's agents in the order they were added. */
    listAgents(): store.Agent[] {
      return store.listAgents(this.ctx.storage);
    }

    /** Adds a task the agent runs `prompt` on `schedule`. An invalid prompt or schedule comes back as `ok: false`. */
    async addTask(agentId: string, input: NewTask): Promise<AddTaskResult | undefined> {
      if (!store.hasAgent(this.ctx.storage, agentId)) {
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
      const wakeAt = await runNext(this.ctx.storage, agentFor(this.env), () => new Date());
      await this.wakeAt(wakeAt);
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
