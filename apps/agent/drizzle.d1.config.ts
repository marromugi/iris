import { defineConfig } from "drizzle-kit";

// The D1 database's migrations, apart from the Durable Object's in drizzle.config.ts. Wrangler
// applies them (`wrangler d1 migrations apply`), reading the .sql files in order.
export default defineConfig({
  out: "./d1-migrations",
  schema: "./src/users/schema.ts",
  dialect: "sqlite",
});
