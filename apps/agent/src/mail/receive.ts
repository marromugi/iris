import { openDatabase } from "../users/database";
import { userIdForMailTag } from "../users/user-store";
import { mailTagOf, type NewMail, parseMail } from "./mail";

/** Where a received mail is kept: the Durable Object of the user it was sent to. */
export interface MailKeeper {
  keep(userId: string, mail: NewMail): Promise<void>;
}

/**
 * Takes mail sent to a user's address and has it kept for them. Mail to an address no user has,
 * and mail too malformed to read, is turned back to its sender.
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
  await keeper.keep(userId, mail);
}
