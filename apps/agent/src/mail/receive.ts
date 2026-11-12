import { openDatabase } from "../users/database";
import { userIdForMailTag } from "../users/user-store";
import { mailTagOf, type NewMail, parseMail } from "./mail";
import { gmailForwardingConfirmation, type MailConfirmation } from "./setup";

/** Where a received mail goes: the Durable Object of the user it was sent to. */
export interface MailKeeper {
  /** Keeps a mail for the user's agents to read. */
  keep(userId: string, mail: NewMail): Promise<void>;
  /** Holds Gmail's forwarding confirmation for the user to open; agents never see it. */
  confirm(userId: string, confirmation: MailConfirmation): Promise<void>;
}

/**
 * Takes mail sent to a user's address: Gmail's forwarding confirmation goes to their mail setup,
 * and any other mail is kept for their agents. Mail to an address no user has, and mail too
 * malformed to read, is turned back to its sender.
 */
export async function receiveMail(
  message: ForwardableEmailMessage,
  db: D1Database,
  keeper: MailKeeper,
  now: () => Date,
): Promise<void> {
  const tag = mailTagOf(message.to);
  const userId = tag === undefined ? undefined : await userIdForMailTag(openDatabase(db), tag);
  if (userId === undefined) {
    message.setReject("No such address.");
    return;
  }
  let mail: NewMail;
  try {
    mail = await parseMail(message.raw, now());
  } catch {
    message.setReject("The message could not be read.");
    return;
  }
  const confirmation = gmailForwardingConfirmation(mail);
  await (confirmation === undefined
    ? keeper.keep(userId, mail)
    : keeper.confirm(userId, confirmation));
}
