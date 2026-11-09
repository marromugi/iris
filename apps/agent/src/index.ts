import { env as workerEnv } from "cloudflare:workers";
import { createApp } from "./app";
import { createUserAgent } from "./user-agent";
import { createWorkersAiModel, WORKERS_AI_MODEL } from "./workers-ai-model";

// Every export of this module is an entrypoint the runtime starts: the Durable Object class and the
// fetch handler, nothing else.

export const UserAgent = createUserAgent((env) => ({
  model: createWorkersAiModel((input) => env.AI.run(WORKERS_AI_MODEL, input)),
  tools: [],
}));
export type UserAgent = InstanceType<typeof UserAgent>;

export default createApp(workerEnv.ORIGIN) satisfies ExportedHandler<Env>;
