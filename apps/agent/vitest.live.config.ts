import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Calls the real Workers AI through the AI binding, so it uses Workers AI neurons and needs
// `wrangler login`. Run by hand with `pnpm --filter @iris/agent-worker test:live`; `pnpm test`
// never picks these files up. Durable Objects stay local.
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      remoteBindings: true,
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["test/live/**/*.live.ts"],
    testTimeout: 120_000,
  },
});
