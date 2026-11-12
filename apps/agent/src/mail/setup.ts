import type { NewMail } from "./mail";

/** Who sends Gmail's mail asking to confirm forwarding to an address. */
export const GMAIL_FORWARDING_SENDER = "forwarding-noreply@google.com";

/**
 * A Gmail forwarding confirmation: the link that confirms the address to Gmail, after which the user
 * turns forwarding on in Gmail's settings, the code that does the same if it has one, and the Gmail
 * account that asked to forward, if the mail names it.
 */
export interface MailConfirmation {
  readonly url: string;
  readonly code: string | null;
  readonly account: string | null;
  readonly receivedAt: Date;
}

/**
 * Where the user's mail setup stands, apart from their address: the confirmation waiting for them,
 * until mail arrives after it, and when mail last arrived.
 */
export interface MailState {
  readonly confirmation: MailConfirmation | null;
  readonly lastMailAt: Date | null;
}

/** Gmail's confirmation links, on the hosts it has sent them from: `/mail/vf-…`, or `/mail/u/<n>/vf-…` for one of several accounts. */
const CONFIRMATION_URL =
  /https:\/\/(?:mail-settings|mail|isolated\.mail)\.google\.com\/mail\/(?:u\/\d+\/)?vf-[^\s()<>"']+/;

/** The code Gmail puts in the subject, as in "(#123456789) Gmail Forwarding Confirmation". */
const CONFIRMATION_CODE = /\(#(\d+)\)/;

/** A mail address, as Gmail names the account in "Receive Mail from hanako@gmail.com". */
const MAIL_ADDRESS = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * The Gmail account asking to forward: the first address in the subject, else in the text, other
 * than `address` itself and Google's own.
 */
function forwardingAccount(mail: NewMail, address: string): string | null {
  const candidates = [...mail.subject.matchAll(MAIL_ADDRESS), ...mail.text.matchAll(MAIL_ADDRESS)];
  const account = candidates
    .map((match) => match[0].toLowerCase())
    .find((found) => found !== address.toLowerCase() && !found.endsWith("@google.com"));
  return account ?? null;
}

/**
 * The confirmation in a mail when it is Gmail's forwarding confirmation for `address`, that is,
 * Gmail sent it to `address` itself (`to` is its To header's addresses); undefined otherwise. One
 * Gmail sent elsewhere and forwarded on, as when someone else adds the user's Gmail address to
 * their own forwarding, isn't the user's.
 */
export function gmailForwardingConfirmation(
  mail: NewMail,
  to: readonly string[],
  address: string,
): MailConfirmation | undefined {
  if (
    mail.from.address.toLowerCase() !== GMAIL_FORWARDING_SENDER ||
    !to.includes(address.toLowerCase())
  ) {
    return undefined;
  }
  // A sentence's full stop after the link isn't part of it.
  const url = CONFIRMATION_URL.exec(mail.text)?.[0].replace(/[.,;:!?]+$/, "");
  return url === undefined
    ? undefined
    : {
        url,
        code: CONFIRMATION_CODE.exec(mail.subject)?.[1] ?? null,
        account: forwardingAccount(mail, address),
        receivedAt: mail.receivedAt,
      };
}
