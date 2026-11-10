import type { AssistantMessage, Model, ModelRequest } from "@iris/agent";
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

export const testAgent = { model, tools: [] };

export const UserAgent = createUserAgent(() => testAgent);
export type UserAgent = InstanceType<typeof UserAgent>;

export default {} satisfies ExportedHandler<Env>;
