import { env as workerEnv } from "cloudflare:workers";
import { createApp } from "./app";
import { bashTool } from "./sandbox/bash-tool";
import { countSearch } from "./store";
import { browserRun, browserTools } from "./web/browser";
import { exaSearcher, searchTool } from "./web/search";
import { createUserAgent } from "./user-agent";
import { createWorkersAiModel, WORKERS_AI_MODEL } from "./workers-ai-model";

// Every export of this module is an entrypoint the runtime starts: the Durable Object classes, the
// S3 gateway the sandboxes' mounts go through, and the fetch handler, nothing else.

export const UserAgent = createUserAgent(
  (env) => ({
    model: createWorkersAiModel((input) => env.AI.run(WORKERS_AI_MODEL, input)),
    tools: [],
  }),
  (env, { agentId }, storage) => {
    const browser = browserRun(env.BROWSER);
    return {
      tools: [
        bashTool({ run: (command) => env.AGENT_SANDBOX.getByName(agentId).run(agentId, command) }),
        searchTool(
          exaSearcher(env.AI),
          { count: (month) => countSearch(storage, month) },
          () => new Date(),
        ),
        ...browserTools(browser),
      ],
      release: () => browser.close(),
    };
  },
);
export type UserAgent = InstanceType<typeof UserAgent>;

export { S3Gateway } from "@cloudflare/sandbox";
export { AgentSandbox } from "./sandbox/agent-sandbox";

export default createApp(workerEnv.ORIGIN) satisfies ExportedHandler<Env>;
