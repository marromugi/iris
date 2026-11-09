import { z } from "zod";

// Runs both in the Worker and on the developer's machine (the invite command), so it uses only what
// both have: WebCrypto and zod.

/** How long an invite key works after it is issued. */
export const INVITE_LIFETIME_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const MAX_USER_NAME_LENGTH = 50;

/** A user's name as an invite gives it: trimmed, not empty. */
export const userNameSchema = z.string().trim().min(1).max(MAX_USER_NAME_LENGTH);

/** An invite as stored. Its key is not here: only its hash is kept. */
export interface NewInvite {
  readonly id: string;
  readonly name: string;
  readonly keyHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

// Crockford's base32: no I, L, O or U, so a key read aloud or retyped is not misread.
const KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KEY_GROUPS = 5;
const KEY_GROUP_LENGTH = 4;

/** A fresh invite key: 20 characters (100 bits) in groups of four, such as `7KQ2-…`. */
function newInviteKey(): string {
  const length = KEY_GROUPS * KEY_GROUP_LENGTH;
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  // 256 is a multiple of the alphabet's 32 letters, so every letter is equally likely.
  const characters = Array.from(bytes, (byte) => KEY_ALPHABET[byte % KEY_ALPHABET.length]);
  return Array.from({ length: KEY_GROUPS }, (_, group) =>
    characters.slice(group * KEY_GROUP_LENGTH, (group + 1) * KEY_GROUP_LENGTH).join(""),
  ).join("-");
}

/** The key as typed, made comparable: case, spaces and dashes ignored, and the letters Crockford reads as digits mapped to them. */
function normalizeInviteKey(typed: string): string {
  return typed.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** What is stored for a key: the SHA-256 of its normalized form, in hex. */
export async function inviteKeyHash(typed: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalizeInviteKey(typed)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A one-time invite for a user to be called `name` (already checked with `userNameSchema`), working
 * for `INVITE_LIFETIME_DAYS` from `now`. The key is returned here and nowhere else.
 */
export async function newInvite(
  name: string,
  now: Date,
): Promise<{ key: string; invite: NewInvite }> {
  const key = newInviteKey();
  return {
    key,
    invite: {
      id: crypto.randomUUID(),
      name,
      keyHash: await inviteKeyHash(key),
      createdAt: now,
      expiresAt: new Date(now.getTime() + INVITE_LIFETIME_DAYS * DAY_MS),
    },
  };
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The SQL that stores `invite` in D1, with its values written out: `wrangler d1 execute` takes a
 * statement, not bound parameters.
 */
export function inviteInsertStatement(invite: NewInvite): string {
  const values = [
    sqlText(invite.id),
    sqlText(invite.name),
    sqlText(invite.keyHash),
    invite.createdAt.getTime(),
    invite.expiresAt.getTime(),
  ];
  return `INSERT INTO invites (id, name, key_hash, created_at, expires_at) VALUES (${values.join(", ")})`;
}
