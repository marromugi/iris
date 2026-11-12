import { defineTool, type Tool } from "@iris/agent";
import { z } from "zod";
import { untrusted } from "../untrusted";
import { type Mail, MAIL_KEPT_DAYS } from "./mail";

/** How many mails one listing shows at most. */
export const MAIL_LIST_LIMIT = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the mail tools call the text they hand the model. */
const MAIL_CONTENT = "mail";

/** Where the mail tools read the user's kept mail. */
export interface MailBox {
  /** The mail from `after` up to before `before`, the latest first, at most `limit`, with how many more there are. */
  list(
    range: { after: Date; before: Date | undefined },
    limit: number,
  ): { mail: Mail[]; more: number };
  /** A mail by ID that arrived from `after`. */
  find(id: string, after: Date): Mail | undefined;
}

/** The mail that is still kept at `now`: what arrived in the last `MAIL_KEPT_DAYS` days. */
export function keptSince(now: Date): Date {
  return new Date(now.getTime() - MAIL_KEPT_DAYS * DAY_MS);
}

/**
 * The tools with which an agent reads the mail the user forwarded: `mail_list` lists it, and
 * `mail_read` reads one. Only mail of the last `MAIL_KEPT_DAYS` days is there.
 */
export function mailTools(box: MailBox, now: () => Date): Tool[] {
  const time = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
  return [
    defineTool({
      name: "mail_list",
      description: `List the mail the user forwarded to you, the latest first: each with its ID, when it arrived, its sender, and subject. Mail is kept for ${MAIL_KEPT_DAYS} days. Read one with mail_read.`,
      input: z.object({
        received_after: time
          .optional()
          .describe("Only mail that arrived at or after this time (ISO 8601 with an offset)"),
        received_before: time
          .optional()
          .describe("Only mail that arrived before this time (ISO 8601 with an offset)"),
      }),
      async run({ received_after: after, received_before: before }) {
        const kept = keptSince(now());
        const { mail, more } = box.list(
          { after: after === undefined || after < kept ? kept : after, before },
          MAIL_LIST_LIMIT,
        );
        return { ok: true, content: mailListReport(mail, more) };
      },
    }),
    defineTool({
      name: "mail_read",
      description:
        "Read one mail the user forwarded: its sender, subject, text, and the names of its attachments.",
      input: z.object({ id: z.string().trim().min(1).describe("The mail's ID from mail_list") }),
      async run({ id }) {
        const mail = box.find(id, keptSince(now()));
        return mail === undefined
          ? {
              ok: false,
              error: `There is no mail ${id}; it may be older than ${MAIL_KEPT_DAYS} days.`,
            }
          : { ok: true, content: mailReport(mail) };
      },
    }),
  ];
}

/** What the model reads of a listing. */
export function mailListReport(mail: readonly Mail[], more: number): string {
  if (mail.length === 0) {
    return "No mail.";
  }
  const lines = mail.map((one) =>
    [
      `[${one.id}] ${one.receivedAt.toISOString()}`,
      `   From: ${sender(one)}`,
      `   Subject: ${one.subject}`,
    ].join("\n"),
  );
  const listed = untrusted(MAIL_CONTENT, lines.join("\n\n"));
  return more === 0 ? listed : `${listed}\n${more} more; list a narrower time range to see them.`;
}

/** What the model reads of one mail. */
export function mailReport(mail: Mail): string {
  const head = [
    `From: ${sender(mail)}`,
    `Subject: ${mail.subject}`,
    `Received: ${mail.receivedAt.toISOString()}`,
  ];
  if (mail.attachmentNames.length > 0) {
    head.push(`Attachments: ${mail.attachmentNames.join(", ")}`);
  }
  return untrusted(MAIL_CONTENT, [...head, "", mail.text].join("\n"));
}

function sender(mail: Mail): string {
  return mail.from.name === "" ? mail.from.address : `${mail.from.name} <${mail.from.address}>`;
}
