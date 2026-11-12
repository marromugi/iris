import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";
import { type Database, openDatabase } from "../src/users/database";

/**
 * Runs `use` on the D1 database: the deployed one when `remote`, otherwise the local one that
 * `pnpm dev` uses. The deployed one is reached through a remote binding, which needs `wrangler login`.
 */
export async function withD1<T>(remote: boolean, use: (db: Database) => Promise<T>): Promise<T> {
  const { env, dispose } = await getPlatformProxy<{ DB: D1Database }>({
    configPath: fileURLToPath(new URL("./d1.jsonc", import.meta.url).href),
    remoteBindings: remote,
    persist: { path: fileURLToPath(new URL("../.wrangler/state/v3", import.meta.url).href) },
  });
  try {
    return await use(openDatabase(env.DB));
  } finally {
    await dispose();
  }
}
