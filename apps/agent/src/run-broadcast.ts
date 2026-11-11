import { postJson, type RunEvent, runJson, WRITING_EVERY_MS } from "./api/schemas";
import type { RunProgress, RunWatcher } from "./runner";
import * as store from "./store";

/** How a run being carried on is getting on, and its writing waiting to go out. */
interface Live {
  readonly threadId: string;
  progress: RunProgress;
  lastWritingAt: number;
  waitingWriting: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Tells each thread's open sockets what happens in it: every run as it changes, how each run being
 * carried on is getting on, and, to sockets that asked for them, the posts sent. A socket that
 * opens during runs hears the latest progress of each at once. Sockets are tagged with their
 * thread's ID and survive the object's hibernation; the progress lives only while this object
 * carries the runs on. Each run's writing goes out at most every `WRITING_EVERY_MS`.
 */
export class RunBroadcast implements RunWatcher {
  private readonly live = new Map<string, Live>();

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
    for (const [runId, live] of this.live) {
      if (live.threadId === threadId) {
        socket.send(JSON.stringify(progressEvent(runId, live.progress)));
      }
    }
  }

  changed(runId: string): void {
    const run = store.findRun(this.ctx.storage, runId);
    if (run === undefined) {
      return;
    }
    this.stopped(runId);
    this.send(run.threadId, { type: "run", run: runJson(run) });
  }

  /** A post was sent in its thread. */
  posted(post: store.Post): void {
    this.send(postsTag(post.threadId), { type: "post", post: postJson(post) });
  }

  progress(runId: string, progress: RunProgress): void {
    let live = this.live.get(runId);
    if (live === undefined) {
      const threadId = store.threadOfRun(this.ctx.storage, runId);
      if (threadId === undefined) {
        return;
      }
      live = {
        threadId,
        progress,
        lastWritingAt: Number.NEGATIVE_INFINITY,
        waitingWriting: undefined,
      };
      this.live.set(runId, live);
    }
    live.progress = progress;
    if (progress.type === "writing") {
      const wait = live.lastWritingAt + WRITING_EVERY_MS - Date.now();
      if (wait > 0) {
        live.waitingWriting ??= setTimeout(() => this.sendWaitingWriting(runId), wait);
        return;
      }
      live.lastWritingAt = Date.now();
    }
    clearTimeout(live.waitingWriting);
    live.waitingWriting = undefined;
    this.send(live.threadId, progressEvent(runId, progress));
  }

  /** The run is no longer being carried on, for now: its progress is let go. */
  stopped(runId: string): void {
    const live = this.live.get(runId);
    clearTimeout(live?.waitingWriting);
    this.live.delete(runId);
  }

  /** No run is being carried on any more, as when the alarm's wake-up is over. */
  idle(): void {
    for (const runId of this.live.keys()) {
      this.stopped(runId);
    }
  }

  private sendWaitingWriting(runId: string): void {
    const live = this.live.get(runId);
    if (live === undefined) {
      return;
    }
    live.waitingWriting = undefined;
    if (live.progress.type !== "writing") {
      return;
    }
    live.lastWritingAt = Date.now();
    this.send(live.threadId, progressEvent(runId, live.progress));
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
