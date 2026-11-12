import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// D1 tables: who may sign in. Each user signs in with passkeys made from a one-time invite. A
// user's own data lives in their Durable Object, named by their ID.

export const users = sqliteTable("users", {
  // A UUID; also the name of the user's Durable Object.
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  // The tag of the user's mail address (`mailAddressOf` in src/mail/mail.ts); null until one is issued.
  mailTag: text("mail_tag").unique(),
});

export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(),
  // The name the user gets when the invite is used.
  name: text("name").notNull(),
  // SHA-256 of the normalized key, in hex. The key itself is shown once and never stored.
  keyHash: text("key_hash").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  // Set when a passkey is made with the key; the key works once.
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
});

export const passkeys = sqliteTable(
  "passkeys",
  {
    // The credential ID, base64url.
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The credential's COSE public key, base64url.
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull(),
    // The transports the authenticator reported, as a JSON array.
    transports: text("transports", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("passkeys_user").on(table.userId)],
);
