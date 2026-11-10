import { type RunEvent, runJson } from "./api/schemas";
import type { RunProgress, RunWatcher } from "./runner";
import * as store from "./store";

/** How often a run's writing goes out at most; the run's next `run` event has the whole message. */
export const WRITING_EVERY_MS = 100;

/**
 * Tells each agent's open sockets what happens to its runs: every run as it changes, and how the
 * run being carried on is getting on. A socket that opens during a run hears the latest progress
 * at once. Sockets are tagged with their agent's ID and survive the object's hibernation; the
 * progress lives only while this object carries the run on.
 */
export class RunBroadcast implements RunWatcher {
  private live: { agentId: string; runId: string; progress: RunProgress } | undefined;
  private lastWritingAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly ctx: DurableObjectState) {}

  /** Takes in a socket for the agent's events. */
  accept(agentId: string, socket: WebSocket): void {
    this.ctx.acceptWebSocket(socket, [agentId]);
    if (this.live?.agentId === agentId) {
      socket.send(JSON.stringify(progressEvent(this.live.runId, this.live.progress)));
    }
  }

  changed(runId: string): void {
    const run = store.findRun(this.ctx.storage, runId);
    if (run === undefined) {
      return;
    }
    if (this.live?.runId === runId) {
      this.live = undefined;
    }
    this.send(run.agentId, { type: "run", run: runJson(run) });
  }

  progress(runId: string, progress: RunProgress): void {
    const agentId =
      this.live?.runId === runId ? this.live.agentId : store.agentOfRun(this.ctx.storage, runId);
    if (agentId === undefined) {
      return;
    }
    this.live = { agentId, runId, progress };
    if (progress.type === "writing") {
      if (Date.now() - this.lastWritingAt < WRITING_EVERY_MS) {
        return;
      }
      this.lastWritingAt = Date.now();
    }
    this.send(agentId, progressEvent(runId, progress));
  }

  /** No run is being carried on any more, as when the alarm's wake-up is over. */
  idle(): void {
    this.live = undefined;
  }

  private send(agentId: string, event: RunEvent): void {
    const text = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets(agentId)) {
      try {
        socket.send(text);
      } catch {
        // The socket is closing; its close handler lets it go.
      }
    }
  }
}

function progressEvent(runId: string, progress: RunProgress): RunEvent {
  return { type: "progress", runId, progress };
}
