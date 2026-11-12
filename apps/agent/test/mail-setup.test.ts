import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import { agentApi, type UserProps } from "../src/api/api";
import type { UserEvent } from "../src/api/schemas";
import * as entry from "../src/index";
import { mailTagOf, type NewMail } from "../src/mail/mail";
import { gmailForwardingConfirmation } from "../src/mail/setup";
import * as store from "../src/store";
import { openDatabase } from "../src/users/database";
import { users } from "../src/users/schema";
import { listen } from "./run-events";

afterEach(async () => {
  await reset();
});

const now = new Date("2026-11-12T09:00:00Z");

/** What the OAuth layer hands a request for a signed-in user. */
function context(props: UserProps) {
  return { props, waitUntil() {}, passThroughOnException() {} };
}

function call(userId: string, path: string, init?: RequestInit) {
  return agentApi.request(path, init, env, context({ userId }));
}

async function addUser(): Promise<string> {
  const id = crypto.randomUUID();
  await openDatabase(env.DB).insert(users).values({ id, name: "花子", createdAt: now });
  return id;
}

const confirmationUrl = "https://mail-settings.google.com/mail/vf-%5BANGjdJ8abc%5D-xYz12_3?ui=2";

/** Gmail's forwarding confirmation for forwarding to `to`, as it arrives, in plain text. */
const gmailConfirmation = (to: string) =>
  [
    "Message-ID: <c1@google.com>",
    "From: Gmail Team <forwarding-noreply@google.com>",
    `To: ${to}`,
    "Subject: (#123456789) Gmail Forwarding Confirmation - Receive Mail from hanako@gmail.com",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "hanako@gmail.com has requested to automatically forward mail to your email address.",
    "To allow hanako@gmail.com to automatically forward mail to your address, please click the link below to confirm the request:",
    "",
    `${confirmationUrl}.`,
    "",
    "Confirmation code: 123456789",
  ].join("\r\n");

const ordinaryMail = [
  "Message-ID: <m1@example.com>",
  "From: boss@example.com",
  "Subject: Hello",
  "",
  "Are you free?",
].join("\r\n");

/** Sends `raw` to `to` through the Worker's email handler, as Email Routing does. */
async function deliver(to: string, raw: string): Promise<void> {
  const message: ForwardableEmailMessage = {
    from: "hanako@gmail.com",
    to,
    headers: new Headers(),
    raw: new Blob([raw]).stream(),
    rawSize: raw.length,
    setReject: (reason) => {
      throw new Error(`Rejected: ${reason}`);
    },
    forward: () => Promise.reject(new Error("Not used.")),
    reply: () => Promise.reject(new Error("Not used.")),
  };
  await entry.default.email(message, env);
}

function newMail(from: string, subject: string, text: string): NewMail {
  return { from: { address: from, name: "" }, subject, text, attachmentNames: [], receivedAt: now };
}

const ADDRESS = "iris+0123456789abcdef01234567@marromugi.me";

test("Gmail's forwarding confirmation to the address gives its link and code, and no other mail does", () => {
  const text = `To confirm, click:\n\n${confirmationUrl}.\n\nConfirmation code: 123456789`;
  const gmail = (subject: string, body: string) =>
    newMail("forwarding-noreply@google.com", subject, body);
  const confirmation = (mail: NewMail, to = [ADDRESS]) =>
    gmailForwardingConfirmation(mail, to, ADDRESS);

  expect(confirmation(gmail("(#123456789) Gmail Forwarding Confirmation", text))).toEqual({
    url: confirmationUrl,
    code: "123456789",
    receivedAt: now,
  });
  expect(
    confirmation(
      newMail(
        "Forwarding-NoReply@google.com",
        "Gmail の転送の確認",
        "確認 (https://mail.google.com/mail/u/0/vf-abc)",
      ),
      [ADDRESS.toUpperCase().toLowerCase()],
    ),
  ).toEqual({ url: "https://mail.google.com/mail/u/0/vf-abc", code: null, receivedAt: now });
  expect(confirmation(newMail("someone@example.com", "(#1) x", text))).toBeUndefined();
  expect(confirmation(gmail("(#1) x", text), ["hanako@gmail.com"])).toBeUndefined();
  for (const other of [
    "https://mail.google.com/mail/",
    "https://mail.google.com/mail/?view=cm&to=a@evil.example&body=vf-",
    "https://mail.google.com/mail/u/0/?continue=https://evil.example/vf-1",
    "https://evil.example/mail/vf-abc",
    "http://mail-settings.google.com/mail/vf-abc",
    "https://mail.google.com.evil.example/mail/vf-abc",
  ]) {
    expect(confirmation(gmail("(#1) x", `click ${other}`))).toBeUndefined();
  }
});

test("a user has no mail setup until they make an address", async () => {
  const userId = await addUser();

  const response = await call(userId, "/api/me/mail");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ address: null, confirmation: null, lastMailAt: null });
});

test("making an address gives the user one that takes mail, and making another retires it", async () => {
  const userId = await addUser();

  const first: { address: string } = await (
    await call(userId, "/api/me/mail/address", { method: "POST" })
  ).json();
  const second: { address: string } = await (
    await call(userId, "/api/me/mail/address", { method: "POST" })
  ).json();

  expect(mailTagOf(first.address)).toBeDefined();
  expect(second).toEqual({ address: expect.any(String), confirmation: null, lastMailAt: null });
  expect(second.address).not.toBe(first.address);
  await expect(deliver(first.address, ordinaryMail)).rejects.toThrow("Rejected: No such address.");
  await deliver(second.address, ordinaryMail);
  expect(await (await call(userId, "/api/me/mail")).json()).toEqual({
    address: second.address,
    confirmation: null,
    lastMailAt: expect.any(String),
  });
});

test("Gmail's confirmation waits for the user, kept from agents, until mail arrives after it", async () => {
  const userId = await addUser();
  const { address }: { address: string } = await (
    await call(userId, "/api/me/mail/address", { method: "POST" })
  ).json();

  await deliver(address, gmailConfirmation(address));
  const waiting = await (await call(userId, "/api/me/mail")).json();
  const keptBefore = await runInDurableObject(env.USER_AGENT.getByName(userId), (_, state) =>
    store.listMail(state.storage, { after: new Date(0), before: undefined }, 10),
  );
  await deliver(address, ordinaryMail);
  const receiving = await (await call(userId, "/api/me/mail")).json();

  expect(waiting).toEqual({
    address,
    confirmation: { url: confirmationUrl, code: "123456789", receivedAt: expect.any(String) },
    lastMailAt: null,
  });
  expect(keptBefore.mail).toEqual([]);
  expect(receiving).toEqual({ address, confirmation: null, lastMailAt: expect.any(String) });
});

test("Gmail's confirmation sent to someone else and forwarded on is kept as mail, not offered", async () => {
  const userId = await addUser();
  const { address }: { address: string } = await (
    await call(userId, "/api/me/mail/address", { method: "POST" })
  ).json();

  await deliver(address, gmailConfirmation("hanako@gmail.com"));

  expect(await (await call(userId, "/api/me/mail")).json()).toEqual({
    address,
    confirmation: null,
    lastMailAt: expect.any(String),
  });
  const kept = await runInDurableObject(env.USER_AGENT.getByName(userId), (_, state) =>
    store.listMail(state.storage, { after: new Date(0), before: undefined }, 10),
  );
  expect(kept.mail.map((mail) => mail.from.address)).toEqual(["forwarding-noreply@google.com"]);
});

test("a second confirmation takes the place of the first", async () => {
  const userId = await addUser();
  const { address }: { address: string } = await (
    await call(userId, "/api/me/mail/address", { method: "POST" })
  ).json();
  const second = gmailConfirmation(address)
    .replace("(#123456789)", "(#987654321)")
    .replace(confirmationUrl, "https://mail-settings.google.com/mail/vf-second");

  await deliver(address, gmailConfirmation(address));
  await deliver(address, second);

  expect(await (await call(userId, "/api/me/mail")).json()).toEqual({
    address,
    confirmation: {
      url: "https://mail-settings.google.com/mail/vf-second",
      code: "987654321",
      receivedAt: expect.any(String),
    },
    lastMailAt: null,
  });
});

test("the app can let go of the confirmation once the user opened it", async () => {
  const userId = await addUser();
  const { address }: { address: string } = await (
    await call(userId, "/api/me/mail/address", { method: "POST" })
  ).json();
  await deliver(address, gmailConfirmation(address));

  const dismissed = await call(userId, "/api/me/mail/confirmation", { method: "DELETE" });

  expect(dismissed.status).toBe(204);
  expect(await (await call(userId, "/api/me/mail")).json()).toEqual({
    address,
    confirmation: null,
    lastMailAt: null,
  });
});

test("a new address starts the setup over and keeps the mail kept so far", async () => {
  const userId = await addUser();
  const { address }: { address: string } = await (
    await call(userId, "/api/me/mail/address", { method: "POST" })
  ).json();
  await deliver(address, ordinaryMail);
  await deliver(address, gmailConfirmation(address));

  const remade = await (await call(userId, "/api/me/mail/address", { method: "POST" })).json();

  expect(remade).toEqual({ address: expect.any(String), confirmation: null, lastMailAt: null });
  const kept = await runInDurableObject(env.USER_AGENT.getByName(userId), (_, state) =>
    store.listMail(state.storage, { after: new Date(0), before: undefined }, 10),
  );
  expect(kept.mail.map((mail) => mail.subject)).toEqual(["Hello"]);
});

test("stopping mail takes the address and the kept mail away", async () => {
  const userId = await addUser();
  const { address }: { address: string } = await (
    await call(userId, "/api/me/mail/address", { method: "POST" })
  ).json();
  await deliver(address, ordinaryMail);

  const stopped = await call(userId, "/api/me/mail/address", { method: "DELETE" });

  expect(stopped.status).toBe(204);
  expect(await (await call(userId, "/api/me/mail")).json()).toEqual({
    address: null,
    confirmation: null,
    lastMailAt: null,
  });
  await expect(deliver(address, ordinaryMail)).rejects.toThrow("Rejected: No such address.");
  const kept = await runInDurableObject(env.USER_AGENT.getByName(userId), (_, state) =>
    store.listMail(state.storage, { after: new Date(0), before: undefined }, 10),
  );
  expect(kept.mail).toEqual([]);
});

test("the user's events socket hears each change of the mail setup", async () => {
  const userId = await addUser();
  const opened = await call(userId, "/api/me/events", { headers: { Upgrade: "websocket" } });
  const socket = listen<UserEvent>(opened.webSocket);
  const [agent]: { id: string }[] = await (await call(userId, "/api/agents")).json();
  const agentSocket = listen(
    (
      await call(userId, `/api/agents/${agent?.id}/events`, {
        headers: { Upgrade: "websocket" },
      })
    ).webSocket,
  );

  const { address }: { address: string } = await (
    await call(userId, "/api/me/mail/address", { method: "POST" })
  ).json();
  await deliver(address, gmailConfirmation(address));
  await deliver(address, ordinaryMail);
  await call(userId, "/api/me/mail/address", { method: "DELETE" });

  expect(opened.status).toBe(101);
  await call(userId, "/api/me/mail/confirmation", { method: "DELETE" });

  expect(await socket.heard(5)).toEqual(Array.from({ length: 5 }, () => ({ type: "mail" })));
  expect(agentSocket.events).toEqual([]);
});

test("the user's events path is only a WebSocket", async () => {
  const response = await call(await addUser(), "/api/me/events");

  expect(response.status).toBe(426);
});
