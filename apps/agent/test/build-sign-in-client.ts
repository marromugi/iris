import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Vitest's global setup, run in Node before any test: bundles the sign-in page's browser script
 * from the current source, since the page and its tests import the bundle and vitest doesn't run
 * wrangler's build command.
 */
export default function buildSignInClient(): void {
  execFileSync("pnpm", ["run", "build:client"], {
    cwd: fileURLToPath(new URL("..", import.meta.url).href),
    stdio: "pipe",
  });
}
