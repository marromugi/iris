import migrations from "../../drizzle/migrations";

/**
 * Applies, in one transaction, the migrations drizzle-kit generated that the storage hasn't had
 * yet, recording them in drizzle's `__drizzle_migrations` table. A failing statement's SQLite
 * error is thrown as is. Refuses storage that has a migration newer than any this code knows,
 * which a newer version of the code wrote.
 */
export function migrate(storage: DurableObjectStorage): void {
  // Not drizzle-orm's own migrator: on a failing statement it throws a bare "Rollback" error and
  // loses the SQLite error.
  storage.transactionSync(() => {
    storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
    );
    const latest = storage.sql
      .exec<{ latest: number | null }>("SELECT max(created_at) AS latest FROM __drizzle_migrations")
      .one().latest;
    const known = Math.max(0, ...migrations.journal.entries.map((entry) => entry.when));
    if (latest !== null && latest > known) {
      throw new Error(
        `Storage has a migration from ${new Date(latest).toISOString()}, newer than any this code knows.`,
      );
    }
    for (const entry of migrations.journal.entries) {
      if (latest !== null && entry.when <= latest) {
        continue;
      }
      const text = migrationText(entry.idx);
      if (text === undefined) {
        throw new Error(`Migration ${entry.tag} is in the journal but its SQL is missing.`);
      }
      for (const statement of text.split("--> statement-breakpoint")) {
        storage.sql.exec(statement);
      }
      storage.sql.exec(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('', ?)",
        entry.when,
      );
    }
  });
}

function migrationText(index: number): string | undefined {
  const sqlByKey: Record<string, string> = migrations.migrations;
  return sqlByKey[`m${index.toString().padStart(4, "0")}`];
}
