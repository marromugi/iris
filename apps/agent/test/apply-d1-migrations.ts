import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    d1Migrations: D1Migration[];
  }
}

// `reset()` empties D1 along with everything else, so every test starts from the migrated schema.
beforeEach(async () => {
  await applyD1Migrations(env.DB, inject("d1Migrations"));
});
