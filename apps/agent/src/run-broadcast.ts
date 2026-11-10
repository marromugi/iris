import { type RunEvent, runJson, WRITING_EVERY_MS } from "./api/schemas";
import type { RunProgress, RunWatcher } from "./runner";
import * as store from "./store";

/**
 * Tells each agent's open sockets what happens to its runs: every run as it changes, and how the
 * run being carried on is getting on. A socket that opens during a run hears the latest progress
 * at once. Sockets are tagged with their agent's ID and survive the object's hibernation; the
 * progress lives only while this object carries the run on.
 */
export class RunBroadcast implements RunWatcher {
  private live: { agentId: string; runId: string; progress: RunProgress } | undefined;
  private lastWritingAt = Number.NEGATIVE_INFINITY;
  private waitingWriting: ReturnType<typeof setTimeout> | undefined;

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
      this.idle();
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
      const wait = this.lastWritingAt + WRITING_EVERY_MS - Date.now();
      if (wait > 0) {
        this.waitingWriting ??= setTimeout(() => this.sendWaitingWriting(), wait);
        return;
      }
      this.lastWritingAt = Date.now();
    }
    this.stopWaiting();
    this.send(agentId, progressEvent(runId, progress));
  }

  /** No run is being carried on any more, as when the alarm's wake-up is over. */
  idle(): void {
    this.stopWaiting();
    this.live = undefined;
  }

  private sendWaitingWriting(): void {
    this.waitingWriting = undefined;
    if (this.live?.progress.type !== "writing") {
      return;
    }
    this.lastWritingAt = Date.now();
    this.send(this.live.agentId, progressEvent(this.live.runId, this.live.progress));
  }

  private stopWaiting(): void {
    clearTimeout(this.waitingWriting);
    this.waitingWriting = undefined;
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
