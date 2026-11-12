import type { NewMail } from "./mail";

/** Who sends Gmail's mail asking to confirm forwarding to an address. */
export const GMAIL_FORWARDING_SENDER = "forwarding-noreply@google.com";

/**
 * A Gmail forwarding confirmation: the link that confirms the address to Gmail, after which the user
 * turns forwarding on in Gmail's settings, and the code that does the same if it has one.
 */
export interface MailConfirmation {
  readonly url: string;
  readonly code: string | null;
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
        receivedAt: mail.receivedAt,
      };
}
