import type { AssistantMessage, Model, ModelRequest } from "@iris/agent";
import type { RunOf, RunTools } from "../src/runner";
import { createUserAgent } from "../src/user-agent";

/**
 * What the test model does on each call, in order: reply with a message, fail with an error, or
 * do something while the call is in flight (report progress, wait) and then reply.
 */
export const scriptedModel: (
  | AssistantMessage
  | Error
  | ((request: ModelRequest) => AssistantMessage | Promise<AssistantMessage>)
)[] = [];

/** The requests the test model was called with, in order. */
export const modelRequests: ModelRequest[] = [];

const model: Model = async (request) => {
  modelRequests.push(request);
  const next = scriptedModel.shift();
  if (next === undefined) {
    throw new Error("The model was called more times than the test scripted.");
  }
  if (next instanceof Error) {
    throw next;
  }
  return typeof next === "function" ? next(request) : next;
};

export const testAgent = { model, tools: [], modelName: "test-model" };

/**
 * The tools each run gets for its own agent, made by `ownTools` with the run's agent's ID. None
 * unless a test sets it.
 */
export const ownTools: { make: (run: RunOf) => RunTools } = { make: () => ({ tools: [] }) };

export const UserAgent = createUserAgent(
  () => testAgent,
  (_env, run) => ownTools.make(run),
);
export type UserAgent = InstanceType<typeof UserAgent>;

export default {} satisfies ExportedHandler<Env>;
