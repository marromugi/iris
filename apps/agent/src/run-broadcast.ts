import { postJson, type RunEvent, runJson, WRITING_EVERY_MS } from "./api/schemas";
import type { RunProgress, RunWatcher } from "./runner";
import * as store from "./store";

/**
 * Tells each thread's open sockets what happens in it: every run as it changes, how the run being
 * carried on is getting on, and, to sockets that asked for them, the posts sent. A socket that
 * opens during a run hears the latest progress at once. Sockets are tagged with their thread's ID
 * and survive the object's hibernation; the progress lives only while this object carries the run
 * on.
 */
export class RunBroadcast implements RunWatcher {
  private live: { threadId: string; runId: string; progress: RunProgress } | undefined;
  private lastWritingAt = Number.NEGATIVE_INFINITY;
  private waitingWriting: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly ctx: DurableObjectState) {}

  /**
   * Takes in a socket for the thread's events. `hears` says whether it also hears posts; the
   * sockets an agent's path opens hear runs only, as the app built before posts reads them.
   */
  accept(threadId: string, socket: WebSocket, hears: "runs" | "runs-and-posts"): void {
    this.ctx.acceptWebSocket(
      socket,
      hears === "runs" ? [threadId] : [threadId, postsTag(threadId)],
    );
    if (this.live?.threadId === threadId) {
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
    this.send(run.threadId, { type: "run", run: runJson(run) });
  }

  /** A post was sent in its thread. */
  posted(post: store.Post): void {
    this.send(postsTag(post.threadId), { type: "post", post: postJson(post) });
  }

  progress(runId: string, progress: RunProgress): void {
    const threadId =
      this.live?.runId === runId ? this.live.threadId : store.threadOfRun(this.ctx.storage, runId);
    if (threadId === undefined) {
      return;
    }
    this.live = { threadId, runId, progress };
    if (progress.type === "writing") {
      const wait = this.lastWritingAt + WRITING_EVERY_MS - Date.now();
      if (wait > 0) {
        this.waitingWriting ??= setTimeout(() => this.sendWaitingWriting(), wait);
        return;
      }
      this.lastWritingAt = Date.now();
    }
    this.stopWaiting();
    this.send(threadId, progressEvent(runId, progress));
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
    this.send(this.live.threadId, progressEvent(this.live.runId, this.live.progress));
  }

  private stopWaiting(): void {
    clearTimeout(this.waitingWriting);
    this.waitingWriting = undefined;
  }

  private send(tag: string, event: RunEvent): void {
    const text = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets(tag)) {
      try {
        socket.send(text);
      } catch {
        // The socket is closing; its close handler lets it go.
      }
    }
  }
}

/** The tag of the sockets that hear the thread's posts. */
function postsTag(threadId: string): string {
  return `posts:${threadId}`;
}

function progressEvent(runId: string, progress: RunProgress): RunEvent {
  return { type: "progress", runId, progress };
}
