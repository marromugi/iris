import PostalMime, { type Address, type Attachment, type RawEmail } from "postal-mime";
import { htmlText } from "./html-text";

const MAIL_LOCAL_PART = "iris";
const MAIL_DOMAIN = "marromugi.me";

/**
 * The address the Worker receives mail at; the Email Routing rule `addresses` in wrangler.jsonc
 * makes for it must name the same one. Each user's own address adds their tag to it, as
 * `iris+<tag>@marromugi.me`.
 */
export const MAIL_ADDRESS = `${MAIL_LOCAL_PART}@${MAIL_DOMAIN}`;

/** How long mail is kept after it arrives. */
export const MAIL_KEPT_DAYS = 7;

/** How much of a mail's text is kept, in UTF-16 code units. */
export const MAX_MAIL_TEXT = 50_000;

/** A user's tag: 24 lowercase hex characters, so no one can guess the address. */
const TAG_PATTERN = /^[0-9a-f]{24}$/;

/** A mail as kept: who sent it, its subject, its text, and the names of its attachments. */
export interface Mail {
  readonly id: string;
  readonly from: { readonly address: string; readonly name: string };
  readonly subject: string;
  readonly text: string;
  readonly attachmentNames: readonly string[];
  readonly receivedAt: Date;
}

export type NewMail = Omit<Mail, "id">;

/** A new random tag for a user's address. */
export function newMailTag(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The user's address for their tag. */
export function mailAddressOf(tag: string): string {
  return `${MAIL_LOCAL_PART}+${tag}@${MAIL_DOMAIN}`;
}

/** The tag of an address made by `mailAddressOf`; undefined for any other address. */
export function mailTagOf(address: string): string | undefined {
  const [localPart, domain, ...rest] = address.toLowerCase().split("@");
  if (rest.length > 0 || domain !== MAIL_DOMAIN) {
    return undefined;
  }
  const prefix = `${MAIL_LOCAL_PART}+`;
  const tag = localPart?.startsWith(prefix) ? localPart.slice(prefix.length) : undefined;
  return tag !== undefined && TAG_PATTERN.test(tag) ? tag : undefined;
}

/**
 * Reads a raw MIME message. The text is the plain text part, or the HTML part made into text when
 * the plain one is missing or blank. Images shown in the body without a name aren't listed as
 * attachments. `to` is the addresses its To header names, in lowercase. Throws on a message too
 * malformed to read.
 */
export async function parseMail(
  raw: RawEmail,
  receivedAt: Date,
): Promise<{ mail: NewMail; to: string[] }> {
  const email = await PostalMime.parse(raw);
  const plain = email.text?.trim() ?? "";
  const text = plain === "" ? htmlText(email.html ?? "").trim() : plain;
  const mail: NewMail = {
    from: mailboxOf(email.from),
    subject: email.subject ?? "",
    text:
      text.length > MAX_MAIL_TEXT
        ? // A cut between the two halves of a character would leave half of it.
          `${text.slice(0, MAX_MAIL_TEXT).replace(/[\ud800-\udbff]$/, "")}\n(the rest of the text is cut)`
        : text,
    attachmentNames: email.attachments
      .filter((attachment) => !isUnnamedInline(attachment))
      .map((attachment) => attachment.filename ?? "(no name)"),
    receivedAt,
  };
  const to = (email.to ?? [])
    .flatMap((address) => (address.group === undefined ? [address] : address.group))
    .map((mailbox) => mailbox.address.toLowerCase());
  return { mail, to };
}

/** An image or the like shown in the body, such as a logo, rather than a file sent along. */
function isUnnamedInline(attachment: Attachment): boolean {
  return attachment.disposition === "inline" && attachment.filename === null;
}

/** The sender as one mailbox: a group's first member, or empty when there is none. */
function mailboxOf(from: Address | undefined): Mail["from"] {
  const mailbox = from?.group === undefined ? from : from.group[0];
  return { address: mailbox?.address ?? "", name: mailbox?.name ?? "" };
}
