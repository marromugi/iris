import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import { mails, mailSetup } from "../db/schema";
import type { Mail } from "../mail/mail";
import type { GmailForwardingRequest, MailState } from "../mail/setup";
import { database } from "./database";

/** Keeps a mail the user forwarded. */
export function insertMail(storage: DurableObjectStorage, mail: Mail): void {
  database(storage)
    .insert(mails)
    .values({
      id: mail.id,
      fromAddress: mail.from.address,
      fromName: mail.from.name,
      subject: mail.subject,
      text: mail.text,
      attachmentNames: [...mail.attachmentNames],
      receivedAt: mail.receivedAt,
    })
    .run();
}

/** Removes the mail that arrived before `cutoff`. */
export function deleteMailBefore(storage: DurableObjectStorage, cutoff: Date): void {
  database(storage).delete(mails).where(lt(mails.receivedAt, cutoff)).run();
}

/**
 * The mail that arrived from `after` up to before `before`, the latest first, at most `limit` of
 * it, with how many more there are.
 */
export function listMail(
  storage: DurableObjectStorage,
  range: { after: Date; before: Date | undefined },
  limit: number,
): { mail: Mail[]; more: number } {
  const where = and(
    gte(mails.receivedAt, range.after),
    range.before === undefined ? undefined : lt(mails.receivedAt, range.before),
  );
  const db = database(storage);
  const rows = db
    .select()
    .from(mails)
    .where(where)
    .orderBy(desc(mails.receivedAt), desc(mails.id))
    .limit(limit)
    .all();
  const total = db.select({ n: count() }).from(mails).where(where).get()?.n ?? 0;
  return { mail: rows.map(toMail), more: Math.max(0, total - rows.length) };
}

/** A kept mail by ID that arrived from `after`, if there is one. */
export function findMail(storage: DurableObjectStorage, id: string, after: Date): Mail | undefined {
  const row = database(storage)
    .select()
    .from(mails)
    .where(and(eq(mails.id, id), gte(mails.receivedAt, after)))
    .get();
  return row === undefined ? undefined : toMail(row);
}

function toMail(row: typeof mails.$inferSelect): Mail {
  return {
    id: row.id,
    from: { address: row.fromAddress, name: row.fromName },
    subject: row.subject,
    text: row.text,
    attachmentNames: row.attachmentNames,
    receivedAt: row.receivedAt,
  };
}

/** Where the user's mail setup stands. */
export function mailState(storage: DurableObjectStorage): MailState {
  const row = database(storage).select().from(mailSetup).get();
  return {
    confirmation:
      row?.confirmationUrl == null || row.confirmationAt === null
        ? null
        : {
            url: row.confirmationUrl,
            code: row.confirmationCode,
            receivedAt: row.confirmationAt,
          },
    forwardingAccount: row?.forwardingAccount ?? null,
    lastMailAt: row?.lastMailAt ?? null,
  };
}

/**
 * Keeps the Gmail forwarding confirmation that arrived, in place of any before it, and the account
 * that asked, which stays until the setup starts over.
 */
export function setMailConfirmation(
  storage: DurableObjectStorage,
  { confirmation, account }: GmailForwardingRequest,
): void {
  const values = {
    confirmationUrl: confirmation.url,
    confirmationCode: confirmation.code,
    confirmationAt: confirmation.receivedAt,
    forwardingAccount: account,
  };
  database(storage)
    .insert(mailSetup)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: mailSetup.id, set: values })
    .run();
}

/** Records that mail arrived at `at`: forwarding works, so the confirmation is done with. */
export function recordMailArrived(storage: DurableObjectStorage, at: Date): void {
  const values = {
    confirmationUrl: null,
    confirmationCode: null,
    confirmationAt: null,
    lastMailAt: at,
  };
  database(storage)
    .insert(mailSetup)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: mailSetup.id, set: values })
    .run();
}

/** Lets go of the Gmail forwarding confirmation, keeping when mail last arrived. */
export function clearMailConfirmation(storage: DurableObjectStorage): void {
  database(storage)
    .update(mailSetup)
    .set({ confirmationUrl: null, confirmationCode: null, confirmationAt: null })
    .run();
}

/** Starts the mail setup over, as for a new address or none. */
export function resetMailSetup(storage: DurableObjectStorage): void {
  database(storage).delete(mailSetup).run();
}

/** Removes all kept mail. */
export function deleteAllMail(storage: DurableObjectStorage): void {
  database(storage).delete(mails).run();
}
