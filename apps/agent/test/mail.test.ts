import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import type { Tool } from "@iris/agent";
import { afterEach, expect, test } from "vitest";
import * as entry from "../src/index";
import {
  type Mail,
  MAIL_ADDRESS,
  MAIL_KEPT_DAYS,
  mailAddressOf,
  mailTagOf,
  MAX_MAIL_TEXT,
  newMailTag,
  type NewMail,
  parseMail,
} from "../src/mail/mail";
import { MAIL_LIST_LIMIT, mailTools } from "../src/mail/mail-tools";
import * as store from "../src/store";
import { untrusted } from "../src/untrusted";
import { openDatabase } from "../src/users/database";
import { mailTagUpdateStatement } from "../src/users/mail-tag";
import { users } from "../src/users/schema";

afterEach(async () => {
  await reset();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-12T09:00:00Z");

function rawMail(headers: Record<string, string>, body: string): string {
  return [
    ...Object.entries({ "Message-ID": "<1@example.com>", ...headers }).map(
      ([key, value]) => `${key}: ${value}`,
    ),
    "",
    body,
  ].join("\r\n");
}

/** A message as Email Routing hands it to the Worker, with the reason it was turned back, if it was. */
function forwarded(to: string, raw: string) {
  const sent = { rejected: undefined as string | undefined };
  const message: ForwardableEmailMessage = {
    from: "someone@gmail.com",
    to,
    headers: new Headers(),
    raw: new Blob([raw]).stream(),
    rawSize: raw.length,
    setReject: (reason) => {
      sent.rejected = reason;
    },
    forward: () => Promise.reject(new Error("Not used.")),
    reply: () => Promise.reject(new Error("Not used.")),
  };
  return { message, sent };
}

async function addUser(id: string, name: string, mailTag: string | null = null) {
  await openDatabase(env.DB).insert(users).values({ id, name, createdAt: now, mailTag });
}

function keptMail(userId: string): Promise<Mail[]> {
  return runInDurableObject(
    env.USER_AGENT.getByName(userId),
    (_, state) =>
      store.listMail(state.storage, { after: new Date(0), before: undefined }, 1000).mail,
  );
}

test("a user's address carries their tag, and only such an address gives one back", () => {
  const tag = newMailTag();

  expect(mailTagOf(mailAddressOf(tag))).toBe(tag);
  expect(mailTagOf(mailAddressOf(tag).toUpperCase())).toBe(tag);
  expect(mailTagOf("iris@marromugi.me")).toBeUndefined();
  expect(mailTagOf(`iris+${tag}@example.com`)).toBeUndefined();
  expect(mailTagOf(`tomoki+${tag}@marromugi.me`)).toBeUndefined();
  expect(mailTagOf("iris+short@marromugi.me")).toBeUndefined();
});

test("a mail is read for its sender, subject, text, and attachment names", async () => {
  const raw = rawMail(
    {
      From: '"Hanako" <hanako@example.com>',
      Subject: "=?UTF-8?B?5piO5pel44Gu5LqI5a6a?=",
      "MIME-Version": "1.0",
      "Content-Type": 'multipart/mixed; boundary="b"',
    },
    [
      "--b",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "See the plan.",
      "--b",
      "Content-Type: application/pdf",
      'Content-Disposition: attachment; filename="plan.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      "JVBERi0=",
      "--b--",
    ].join("\r\n"),
  );

  expect(await parseMail(raw, now)).toEqual({
    from: { address: "hanako@example.com", name: "Hanako" },
    subject: "明日の予定",
    text: "See the plan.",
    attachmentNames: ["plan.pdf"],
    receivedAt: now,
  });
});

test("a mail with only HTML is read as its text, and a long text is cut", async () => {
  const html = await parseMail(
    rawMail(
      { From: "news@example.com", "Content-Type": "text/html; charset=utf-8" },
      "<html><body><p>Sale <b>today</b></p></body></html>",
    ),
    now,
  );
  const long = await parseMail(
    rawMail({ From: "a@example.com" }, "x".repeat(MAX_MAIL_TEXT + 10)),
    now,
  );

  expect(html.text).toContain("Sale");
  expect(html.text).not.toContain("<b>");
  expect(long.text).toBe(`${"x".repeat(MAX_MAIL_TEXT)}\n(the rest of the text is cut)`);
});

test("mail to a user's address is kept in their Durable Object", async () => {
  const tag = newMailTag();
  await addUser("user-1", "Hanako", tag);
  const { message, sent } = forwarded(
    mailAddressOf(tag),
    rawMail({ From: "boss@example.com", Subject: "Hello" }, "Are you free?"),
  );

  await entry.default.email(message, env);

  expect(sent.rejected).toBeUndefined();
  expect(await keptMail("user-1")).toEqual([
    {
      id: expect.any(String),
      from: { address: "boss@example.com", name: "" },
      subject: "Hello",
      text: "Are you free?",
      attachmentNames: [],
      receivedAt: expect.any(Date),
    },
  ]);
});

test("mail to an address no user has is turned back", async () => {
  await addUser("user-1", "Hanako", newMailTag());

  for (const to of [mailAddressOf(newMailTag()), MAIL_ADDRESS]) {
    const { message, sent } = forwarded(to, rawMail({ From: "a@example.com" }, "Hi"));
    await entry.default.email(message, env);
    expect(sent.rejected).toBe("No such address.");
  }
  expect(await keptMail("user-1")).toEqual([]);
});

function newMail(subject: string, receivedAt: Date): NewMail {
  return {
    from: { address: "a@example.com", name: "" },
    subject,
    text: "",
    attachmentNames: [],
    receivedAt,
  };
}

test(`keeping a mail lets go of what arrived more than ${MAIL_KEPT_DAYS} days before it`, async () => {
  const agent = env.USER_AGENT.getByName("user-1");

  await agent.keepMail(newMail("old", new Date(now.getTime() - MAIL_KEPT_DAYS * DAY_MS - 1)));
  await agent.keepMail(newMail("week", new Date(now.getTime() - MAIL_KEPT_DAYS * DAY_MS)));
  await agent.keepMail(newMail("new", now));

  expect((await keptMail("user-1")).map((kept) => kept.subject)).toEqual(["new", "week"]);
});

function storedMail(id: string, receivedAt: Date): Mail {
  return {
    id,
    from: { address: "shop@example.com", name: "Shop" },
    subject: `Mail ${id}`,
    text: `Text of ${id}`,
    attachmentNames: id === "m2" ? ["receipt.pdf"] : [],
    receivedAt,
  };
}

type MailTools = {
  list: (input: object) => ReturnType<Tool["run"]>;
  read: (id: string) => ReturnType<Tool["run"]>;
};

/** Runs `use` with the mail tools on user-1's storage with `mail` in it, at `now`. */
async function withTools<T>(mail: readonly Mail[], use: (tools: MailTools) => Promise<T>) {
  return runInDurableObject(env.USER_AGENT.getByName("user-1"), (_, state) => {
    for (const one of mail) {
      store.insertMail(state.storage, one);
    }
    const [list, read] = mailTools(
      {
        list: (range, limit) => store.listMail(state.storage, range, limit),
        find: (id, after) => store.findMail(state.storage, id, after),
      },
      () => now,
    );
    if (list === undefined || read === undefined) {
      throw new Error("mailTools gave fewer than two tools.");
    }
    return use({
      list: (input) => list.run(list.input.parse(input), { id: "call-1" }),
      read: (id) => read.run(read.input.parse({ id }), { id: "call-2" }),
    });
  });
}

test("mail_list lists the kept mail in a range, the latest first, framed as mail", async () => {
  const [yesterday, later] = await withTools(
    [
      storedMail("m1", new Date("2026-11-10T23:00:00Z")),
      storedMail("m2", new Date("2026-11-11T08:00:00Z")),
      storedMail("m3", new Date("2026-11-12T01:00:00Z")),
    ],
    async (tools) => [
      await tools.list({
        received_after: "2026-11-11T00:00:00+09:00",
        received_before: "2026-11-12T00:00:00+09:00",
      }),
      await tools.list({ received_after: "2026-11-13T00:00:00Z" }),
    ],
  );

  expect(yesterday).toEqual({
    ok: true,
    content: untrusted(
      "mail",
      [
        "[m2] 2026-11-11T08:00:00.000Z\n   From: Shop <shop@example.com>\n   Subject: Mail m2",
        "[m1] 2026-11-10T23:00:00.000Z\n   From: Shop <shop@example.com>\n   Subject: Mail m1",
      ].join("\n\n"),
    ),
  });
  expect(later).toEqual({
    ok: true,
    content: "No mail.",
  });
});

test(`mail_list shows no mail older than ${MAIL_KEPT_DAYS} days, and says how many it left out`, async () => {
  const kept = Array.from({ length: MAIL_LIST_LIMIT + 2 }, (_, index) =>
    storedMail(`k${index}`, new Date(now.getTime() - index * 60_000)),
  );
  const listed = await withTools(
    [storedMail("old", new Date(now.getTime() - MAIL_KEPT_DAYS * DAY_MS - 1)), ...kept],
    (tools) => tools.list({ received_after: "2026-01-01T00:00:00Z" }),
  );

  expect(listed.ok && listed.content).toContain("2 more; list a narrower time range to see them.");
  expect(listed.ok && listed.content).not.toContain("[old]");
});

test("mail_read reads one kept mail, and says when there is none", async () => {
  const [kept, old] = await withTools(
    [
      storedMail("m2", new Date("2026-11-11T08:00:00Z")),
      storedMail("old", new Date(now.getTime() - MAIL_KEPT_DAYS * DAY_MS - 1)),
    ],
    async (tools) => [await tools.read("m2"), await tools.read("old")],
  );

  expect(kept).toEqual({
    ok: true,
    content: untrusted(
      "mail",
      [
        "From: Shop <shop@example.com>",
        "Subject: Mail m2",
        "Received: 2026-11-11T08:00:00.000Z",
        "Attachments: receipt.pdf",
        "",
        "Text of m2",
      ].join("\n"),
    ),
  });
  expect(old).toEqual({
    ok: false,
    error: `There is no mail old; it may be older than ${MAIL_KEPT_DAYS} days.`,
  });
});

test("a new mail tag goes to the one user with the name, and to none when two share it", async () => {
  await addUser("user-1", "Hanako", "a".repeat(24));
  await addUser("user-2", "Taro");
  await addUser("user-3", "Taro");
  const tag = newMailTag();
  const db = openDatabase(env.DB);
  const tagOf = async (id: string) =>
    (await db.select({ tag: users.mailTag }).from(users).where(eq(users.id, id)).get())?.tag;

  const hanako = await env.DB.prepare(mailTagUpdateStatement("Hanako", tag)).run();
  const taro = await env.DB.prepare(mailTagUpdateStatement("Taro", newMailTag())).run();

  expect(hanako.meta.changes).toBe(1);
  expect(await tagOf("user-1")).toBe(tag);
  expect(taro.meta.changes).toBe(0);
  expect([await tagOf("user-2"), await tagOf("user-3")]).toEqual([null, null]);
});
