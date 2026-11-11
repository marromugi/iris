import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Calls the real Workers AI through the AI binding, which uses Workers AI neurons and needs
// `wrangler login`, and the real Claude API with ANTHROPIC_API_KEY (from .dev.vars or the
// environment), which is charged to that key's account. Run by hand with
// `pnpm --filter @iris/agent-worker test:live`; `pnpm test` never picks these files up.
// `MODEL_PROVIDER=workers-ai` in the environment runs the Worker's own wiring on that provider
// instead of the one wrangler.jsonc names. Every other binding (Durable Objects, D1, KV, the rate
// limit) stays local, as long as none sets `remote: true` in wrangler.jsonc.
const provider = process.env.MODEL_PROVIDER;

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      remoteBindings: true,
      wrangler: { configPath: "./wrangler.jsonc" },
      ...(provider === undefined ? {} : { miniflare: { bindings: { MODEL_PROVIDER: provider } } }),
    }),
  ],
  test: {
    include: ["test/live/**/*.live.ts"],
    testTimeout: 120_000,
    // The Workers pool drops intercepted console output; the point of this check is to read what the model said.
    disableConsoleIntercept: true,
  },
});
