import type { Agent } from "@iris/agent";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { nextWakeAt, runNext } from "./runner";
import { nextRunAt } from "./schedule";
import * as store from "./store";
import { type NewTask, newTaskSchema } from "./task";

const DEFAULT_RECENT_RUNS = 20;

export type AddTaskResult =
  | { readonly ok: true; readonly task: store.Task }
  | { readonly ok: false; readonly error: string };

/**
 * Builds the Durable Object class for one user's agent. One object per user holds that user's
 * tasks and runs; `agentFor` gives the model and tools its runs use.
 */
export function createUserAgent(agentFor: (env: Env) => Agent) {
  return class UserAgent extends DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      store.migrate(ctx.storage);
    }

    /** Adds a task that runs `prompt` on `schedule`. An invalid prompt or schedule comes back as `ok: false`. */
    async addTask(input: NewTask): Promise<AddTaskResult> {
      const parsed = newTaskSchema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, error: z.prettifyError(parsed.error) };
      }
      const now = new Date();
      const task: store.Task = {
        id: crypto.randomUUID(),
        prompt: parsed.data.prompt,
        schedule: parsed.data.schedule,
        nextRunAt: nextRunAt(parsed.data.schedule, now),
      };
      store.insertTask(this.ctx.storage, task);
      await this.wakeAt(nextWakeAt(this.ctx.storage));
      return { ok: true, task };
    }

    /** Removes a task and says whether there was one. Runs it already started carry on. */
    async removeTask(id: string): Promise<boolean> {
      const removed = store.deleteTask(this.ctx.storage, id);
      await this.wakeAt(nextWakeAt(this.ctx.storage));
      return removed;
    }

    listTasks(): store.Task[] {
      return store.listTasks(this.ctx.storage);
    }

    /** The latest runs first, at most `limit` of them, each with its conversation. */
    recentRuns(limit = DEFAULT_RECENT_RUNS): store.Run[] {
      return store.recentRuns(this.ctx.storage, limit);
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
