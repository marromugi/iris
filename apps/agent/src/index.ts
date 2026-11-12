import Anthropic from "@anthropic-ai/sdk";
import type { Model } from "@iris/agent";
import { env as workerEnv } from "cloudflare:workers";
import { z } from "zod";
import { ANTHROPIC_MODEL, createAnthropicModel } from "./anthropic-model";
import { createApp } from "./app";
import { bashTool } from "./sandbox/bash-tool";
import { countSearch } from "./store";
import { browserRun, browserTools } from "./web/browser";
import { exaSearcher, searchTool } from "./web/search";
import { createUserAgent } from "./user-agent";
import { createWorkersAiModel, WORKERS_AI_MODEL } from "./workers-ai-model";

// Every export of this module is an entrypoint the runtime starts: the Durable Object classes, the
// S3 gateway the sandboxes' mounts go through, and the fetch handler, nothing else.

const modelProviderSchema = z.enum(["anthropic", "workers-ai"]);

// Read when the Worker starts, so a value it doesn't know stops the Worker from starting instead
// of failing each run.
const modelProvider = modelProviderOf(workerEnv.MODEL_PROVIDER);

export const UserAgent = createUserAgent(
  (env) => ({ ...modelOf(env), tools: [] }),
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

function modelProviderOf(value: string): z.infer<typeof modelProviderSchema> {
  const provider = modelProviderSchema.safeParse(value);
  if (!provider.success) {
    throw new Error(
      `MODEL_PROVIDER is "${value}"; it must be one of ${modelProviderSchema.options.join(", ")}.`,
    );
  }
  return provider.data;
}

/** The model of the provider `MODEL_PROVIDER` names, and that model's name. */
function modelOf(env: Env): { model: Model; modelName: string } {
  return modelProvider === "anthropic"
    ? {
        model: createAnthropicModel(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })),
        modelName: ANTHROPIC_MODEL,
      }
    : {
        model: createWorkersAiModel((input) => env.AI.run(WORKERS_AI_MODEL, input)),
        modelName: WORKERS_AI_MODEL,
      };
}
