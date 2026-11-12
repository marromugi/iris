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
  {
    readonly modelName: string;
    readonly model: (env: Env) => Model;
    /** Whether the model reads images, so posts may carry them. */
    readonly readsImages: boolean;
  }
> = {
  anthropic: {
    modelName: ANTHROPIC_MODEL,
    readsImages: true,
    model: (env) => createAnthropicModel(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })),
  },
  "workers-ai": {
    modelName: WORKERS_AI_MODEL,
    readsImages: false,
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

/** Whether posts may carry images: only when the model every agent thinks with reads them. */
export function canAttachImages(env: Env): boolean {
  return modelProviders[modelProviderOf(env.MODEL_PROVIDER)].readsImages;
}
