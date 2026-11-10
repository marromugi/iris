import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineProject } from "vitest/config";

export default defineProject(async () => ({
  plugins: [
    cloudflareTest({
      main: "./test/worker.ts",
      // Tests never reach Cloudflare: no sign-in, no Workers AI usage.
      remoteBindings: false,
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    provide: {
      d1Migrations: await readD1Migrations(
        fileURLToPath(new URL("./d1-migrations", import.meta.url).href),
      ),
    },
    globalSetup: ["./test/build-sign-in-client.ts"],
    setupFiles: ["./test/apply-d1-migrations.ts"],
  },
}));
