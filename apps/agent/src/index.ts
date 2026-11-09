import { createUserAgent } from "./user-agent";
import { createWorkersAiModel } from "./workers-ai-model";

/** The Workers AI model every user's agent thinks with. */
const MODEL = "@cf/zai-org/glm-4.7-flash";

export const UserAgent = createUserAgent((env) => ({
  model: createWorkersAiModel((input) => env.AI.run(MODEL, input)),
  tools: [],
}));
export type UserAgent = InstanceType<typeof UserAgent>;

// Nothing is reachable from outside until sign-in exists; user agents are reached over RPC only.
export default {
  fetch: () => new Response("Not found", { status: 404 }),
} satisfies ExportedHandler<Env>;
