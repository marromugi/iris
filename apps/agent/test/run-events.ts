import type { RunEvent } from "../src/api/schemas";

/** Takes in the client end of an events socket and keeps what it hears. */
export function listen(socket: WebSocket | null) {
  if (socket === null) {
    throw new Error("The response carries no WebSocket.");
  }
  const events: RunEvent[] = [];
  socket.addEventListener("message", (event) => {
    events.push(JSON.parse(String(event.data)));
  });
  socket.accept();
  return {
    events,
    /** Waits until the socket has heard `count` events, failing after two seconds. */
    async heard(count: number): Promise<RunEvent[]> {
      for (let waited = 0; events.length < count; waited += 10) {
        if (waited >= 2000) {
          throw new Error(`Heard ${events.length} events, not ${count}: ${JSON.stringify(events)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return events;
    },
  };
}
