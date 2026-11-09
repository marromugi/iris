import type { AssistantMessage, Model } from "@iris/agent";
import { createUserAgent } from "../src/user-agent";

/**
 * What the test model does on each call, in order: reply with a message, fail with an error, or
 * do something while the call is in flight and then reply.
 */
export const scriptedModel: (AssistantMessage | Error | (() => AssistantMessage))[] = [];

const model: Model = async () => {
  const next = scriptedModel.shift();
  if (next === undefined) {
    throw new Error("The model was called more times than the test scripted.");
  }
  if (next instanceof Error) {
    throw next;
  }
  return typeof next === "function" ? next() : next;
};

export const testAgent = { model, tools: [] };

export const UserAgent = createUserAgent(() => testAgent);
export type UserAgent = InstanceType<typeof UserAgent>;

export default {} satisfies ExportedHandler<Env>;
