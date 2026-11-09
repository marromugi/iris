import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [
    cloudflareTest({
      main: "./test/worker.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
