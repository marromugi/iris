import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Database = DrizzleD1Database<typeof schema> & { $client: D1Database };

/** The D1 database of users, their passkeys, and invites. */
export function openDatabase(d1: D1Database): Database {
  return drizzle(d1, { schema });
}
