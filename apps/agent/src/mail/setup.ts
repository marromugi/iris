import type { NewMail } from "./mail";

/** Who sends Gmail's mail asking to confirm forwarding to an address. */
export const GMAIL_FORWARDING_SENDER = "forwarding-noreply@google.com";

/** A Gmail forwarding confirmation: the link that turns forwarding on, and its code if it has one. */
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

/** Gmail's confirmation links, on either of the hosts it has sent them from. */
const CONFIRMATION_URL =
  /https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s()<>"']*vf-[^\s()<>"']*/;

/** The code Gmail puts in the subject, as in "(#123456789) Gmail Forwarding Confirmation". */
const CONFIRMATION_CODE = /\(#(\d+)\)/;

/** The confirmation in a mail when it is Gmail's forwarding confirmation; undefined otherwise. */
export function gmailForwardingConfirmation(mail: NewMail): MailConfirmation | undefined {
  if (mail.from.address.toLowerCase() !== GMAIL_FORWARDING_SENDER) {
    return undefined;
  }
  const url = CONFIRMATION_URL.exec(mail.text)?.[0];
  return url === undefined
    ? undefined
    : {
        url,
        code: CONFIRMATION_CODE.exec(mail.subject)?.[1] ?? null,
        receivedAt: mail.receivedAt,
      };
}
