import { drizzle } from "drizzle-orm/durable-sqlite";

export function database(storage: DurableObjectStorage) {
  return drizzle(storage);
}
