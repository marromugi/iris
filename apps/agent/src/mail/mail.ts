import PostalMime, { type Address, type RawEmail } from "postal-mime";

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

/** How much of a mail's text is kept, in characters. */
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
 * there is no plain one. Throws on a message too malformed to read.
 */
export async function parseMail(raw: RawEmail, receivedAt: Date): Promise<NewMail> {
  const email = await PostalMime.parse(raw);
  const text = (email.text ?? htmlText(email.html ?? "")).trim();
  return {
    from: mailboxOf(email.from),
    subject: email.subject ?? "",
    text:
      text.length > MAX_MAIL_TEXT
        ? `${text.slice(0, MAX_MAIL_TEXT)}\n(the rest of the text is cut)`
        : text,
    attachmentNames: email.attachments.map((attachment) => attachment.filename ?? "(no name)"),
    receivedAt,
  };
}

/** The text of an HTML body: no markup, a line break where a block ends, entities written out. */
export function htmlText(html: string): string {
  return html
    .replace(/<(head|style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\b[^>]*>|<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => entityText(name) ?? entity)
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function entityText(name: string): string | undefined {
  if (name.startsWith("#")) {
    const code =
      name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : undefined;
  }
  return NAMED_ENTITIES[name.toLowerCase()];
}

/** The sender as one mailbox: a group's first member, or empty when there is none. */
function mailboxOf(from: Address | undefined): Mail["from"] {
  const mailbox = from?.group === undefined ? from : from.group[0];
  return { address: mailbox?.address ?? "", name: mailbox?.name ?? "" };
}
