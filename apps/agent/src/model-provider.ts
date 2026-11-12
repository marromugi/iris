import Anthropic from "@anthropic-ai/sdk";
import type { Model } from "@iris/agent";
import { z } from "zod";
import { ANTHROPIC_MODEL, createAnthropicModel } from "./anthropic-model";
import { createWorkersAiModel, WORKERS_AI_MODEL } from "./workers-ai-model";

const modelProviderSchema = z.enum(["anthropic", "workers-ai"]);

/** Whose model every agent thinks with, as `MODEL_PROVIDER` names it. */
export type ModelProvider = z.infer<typeof modelProviderSchema>;

/** For each provider, the name of the model it uses and how that model is made from the Worker's env. */
export const modelProviders: Record<
  ModelProvider,
  { readonly modelName: string; readonly model: (env: Env) => Model }
> = {
  anthropic: {
    modelName: ANTHROPIC_MODEL,
    model: (env) => createAnthropicModel(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })),
  },
  "workers-ai": {
    modelName: WORKERS_AI_MODEL,
    model: (env) => createWorkersAiModel((input) => env.AI.run(WORKERS_AI_MODEL, input)),
  },
};

/** The provider `value` names; throws when it names none. */
export function modelProviderOf(value: string): ModelProvider {
  const provider = modelProviderSchema.safeParse(value);
  if (!provider.success) {
    throw new Error(
      `MODEL_PROVIDER is "${value}"; it must be one of ${modelProviderSchema.options.join(", ")}.`,
    );
  }
  return provider.data;
}
