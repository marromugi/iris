import type { UserEvent } from "./api/schemas";

/** The tag of the sockets that hear the user's own events, apart from any thread's. */
const USER_EVENTS_TAG = "user";

/** Takes in a socket for the user's own events. */
export function acceptUserSocket(ctx: DurableObjectState, socket: WebSocket): void {
  ctx.acceptWebSocket(socket, [USER_EVENTS_TAG]);
}

/** Tells the user's open sockets about `event`. */
export function sendUserEvent(ctx: DurableObjectState, event: UserEvent): void {
  const text = JSON.stringify(event);
  for (const socket of ctx.getWebSockets(USER_EVENTS_TAG)) {
    try {
      socket.send(text);
    } catch {
      // The socket is closing; its close handler lets it go.
    }
  }
}
