import * as store from "../src/store";

/** The ID of the agent's own one-to-one thread, for tests that put tasks and runs straight into storage. */
export function agentThread(storage: DurableObjectStorage, agentId: string): string {
  const threadId = store.agentThreadId(storage, agentId);
  if (threadId === undefined) {
    throw new Error(`The user has no agent ${agentId}.`);
  }
  return threadId;
}
