import { and, eq } from "drizzle-orm";
import type { Database } from "./database";
import { inviteKeyHash, type NewInvite } from "./invite";
import { invites, passkeys, users } from "./schema";

/** Someone who may sign in. Their ID also names their Durable Object. */
export interface User {
  readonly id: string;
  readonly name: string;
}

/** Why an invite key can't be used. */
export type InviteRefusal = "unknown-key" | "used-key" | "expired-key";

export type InviteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: InviteRefusal };

/** A passkey as stored: what verifying a sign-in needs. */
export interface StoredPasskey {
  readonly id: string;
  readonly userId: string;
  readonly publicKey: string;
  readonly counter: number;
  readonly transports: string[];
}

/** The invite a typed key names, while it is unused and unexpired. */
export async function inviteForKey(
  db: Database,
  typedKey: string,
  now: Date,
): Promise<InviteResult<{ id: string; name: string }>> {
  const invite = await db
    .select()
    .from(invites)
    .where(eq(invites.keyHash, await inviteKeyHash(typedKey)))
    .get();
  if (invite === undefined) {
    return { ok: false, refusal: "unknown-key" };
  }
  if (invite.usedAt !== null) {
    return { ok: false, refusal: "used-key" };
  }
  if (invite.expiresAt <= now) {
    return { ok: false, refusal: "expired-key" };
  }
  return { ok: true, value: { id: invite.id, name: invite.name } };
}

/**
 * Adds a user named by the invite, with their first passkey, and marks the invite used, all or
 * nothing. Refused when the invite was used or expired in the meantime, so a key never makes two
 * users.
 */
export async function addUser(
  db: Database,
  draft: { inviteId: string; userId: string; passkey: Omit<StoredPasskey, "userId"> },
  now: Date,
): Promise<InviteResult<User>> {
  const at = now.getTime();
  const { inviteId, userId, passkey } = draft;
  // One D1 batch is one transaction. The user is added only while the invite is unused and
  // unexpired, and the passkey and the invite's use only once the user is there, so a used or
  // expired invite adds nothing at all.
  const d1 = db.$client;
  const [added] = await d1.batch([
    d1
      .prepare(
        "INSERT INTO users (id, name, created_at) SELECT ?1, name, ?2 FROM invites WHERE id = ?3 AND used_at IS NULL AND expires_at > ?2",
      )
      .bind(userId, at, inviteId),
    d1
      .prepare(
        "INSERT INTO passkeys (id, user_id, public_key, counter, transports, created_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM users WHERE id = ?2)",
      )
      .bind(
        passkey.id,
        userId,
        passkey.publicKey,
        passkey.counter,
        JSON.stringify(passkey.transports),
        at,
      ),
    d1
      .prepare(
        "UPDATE invites SET used_at = ?1, user_id = ?2 WHERE id = ?3 AND EXISTS (SELECT 1 FROM users WHERE id = ?2)",
      )
      .bind(at, userId, inviteId),
  ]);
  if (added === undefined || added.meta.changes === 0) {
    const invite = await db.select().from(invites).where(eq(invites.id, inviteId)).get();
    if (invite === undefined) {
      return { ok: false, refusal: "unknown-key" };
    }
    return { ok: false, refusal: invite.usedAt === null ? "expired-key" : "used-key" };
  }
  const user = await userWithId(db, userId);
  if (user === undefined) {
    throw new Error(`User ${userId} was added in a batch but does not read back.`);
  }
  return { ok: true, value: user };
}

/** A stored passkey by its credential ID, if there is one (never made, or its user was removed). */
export async function passkeyWithId(db: Database, id: string): Promise<StoredPasskey | undefined> {
  const row = await db.select().from(passkeys).where(eq(passkeys.id, id)).get();
  return row === undefined
    ? undefined
    : {
        id: row.id,
        userId: row.userId,
        publicKey: row.publicKey,
        counter: row.counter,
        transports: row.transports,
      };
}

/** Records a sign-in with a passkey: its new signature counter and when it was used. */
export async function recordPasskeyUse(
  db: Database,
  id: string,
  counter: number,
  now: Date,
): Promise<void> {
  await db.update(passkeys).set({ counter, lastUsedAt: now }).where(eq(passkeys.id, id));
}

/** A user by ID, if there is one. */
export async function userWithId(db: Database, id: string): Promise<User | undefined> {
  return db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, id)).get();
}

/** The ID of the user whose mail address has `tag`, if there is one. */
export async function userIdForMailTag(db: Database, tag: string): Promise<string | undefined> {
  const row = await db.select({ id: users.id }).from(users).where(eq(users.mailTag, tag)).get();
  return row?.id;
}

/** Stores a new invite. */
export async function addInvite(db: Database, invite: NewInvite): Promise<void> {
  await db.insert(invites).values(invite);
}

/**
 * Gives the one user named `name` the mail tag `tag`, replacing the tag they had, and says whether
 * there was one such user. Nothing changes when no user, or more than one, has the name.
 */
export async function giveMailTag(db: Database, name: string, tag: string): Promise<boolean> {
  const named = eq(users.name, name);
  const changed = await db
    .update(users)
    .set({ mailTag: tag })
    .where(and(named, eq(db.$count(users, named), 1)))
    .returning({ id: users.id });
  return changed.length === 1;
}
