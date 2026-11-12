import { expect, test } from "vitest";
import { modelProviderOf, modelProviders } from "../src/model-provider";

test("each provider names the model it uses", () => {
  expect(modelProviders.anthropic.modelName).toBe("claude-haiku-5-5");
  expect(modelProviders["workers-ai"].modelName).toBe("@cf/zai-org/glm-4.7-flash");
});

test("MODEL_PROVIDER must name a provider", () => {
  expect(modelProviderOf("workers-ai")).toBe("workers-ai");
  expect(() => modelProviderOf("bogus")).toThrow(
    'MODEL_PROVIDER is "bogus"; it must be one of anthropic, workers-ai.',
  );
});
