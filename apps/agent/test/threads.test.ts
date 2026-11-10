import type { AssistantMessage } from "@iris/agent";
import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import * as store from "../src/store";
import { modelRequests, scriptedModel } from "./worker";

/** Sorts IDs as text, for comparing sets of them. */
const byText = (a: string | undefined, b: string | undefined) => (a ?? "").localeCompare(b ?? "");

afterEach(async () => {
  scriptedModel.length = 0;
  modelRequests.length = 0;
  await reset();
});

const userAgent = () => env.USER_AGENT.getByName("user-1");

const reply = (text: string): AssistantMessage => ({
  role: "assistant",
  parts: [{ type: "text", text }],
});

/** Adds agents with these names after the first one, and a group of all of them; returns their IDs and the group's. */
async function groupOf(...names: string[]) {
  const agentIds: string[] = [];
  for (const name of names) {
    const added = await userAgent().addAgent({ name });
    if (!added.ok) {
      throw new Error(added.error);
    }
    agentIds.push(added.agent.id);
  }
  const group = await userAgent().addGroup({ name: "チーム", agentIds });
  if (!group.ok) {
    throw new Error(group.error);
  }
  return { agentIds, groupId: group.thread.id };
}

test("a group needs a name and two or more of the user's agents, each once", async () => {
  const { agentIds } = await groupOf("メール", "株価");
  const [mail = "", stocks = ""] = agentIds;

  const results = await Promise.all([
    userAgent().addGroup({ name: "一人", agentIds: [mail] }),
    userAgent().addGroup({ name: "重複", agentIds: [mail, mail] }),
    userAgent().addGroup({ name: "知らない", agentIds: [mail, crypto.randomUUID()] }),
    userAgent().addGroup({ name: " ", agentIds: [mail, stocks] }),
  ]);

  expect(results.map((result) => result.ok)).toEqual([false, false, false, false]);
});

test("the home lists one-to-one threads and groups together, the latest activity first", async () => {
  const { agentIds, groupId } = await groupOf("メール", "株価");
  const [first] = await userAgent().listAgents();
  const firstThread = (await userAgent().listThreads()).find(
    (thread) => thread.agentId === first?.id,
  );
  await userAgent().sendMessage(first?.id ?? "", { text: "Hi" });

  const threads = await userAgent().listThreads();

  expect(threads.map((thread) => [thread.name, thread.agentIds])).toEqual([
    ["エージェント", [first?.id]],
    ["チーム", agentIds],
    ["株価", [agentIds[1]]],
    ["メール", [agentIds[0]]],
  ]);
  expect(threads[0]?.id).toBe(firstThread?.id);
  expect(threads[1]).toMatchObject({ id: groupId, agentId: null });
});

test("a post naming nobody gets a reply from every member, and the next post reads them", async () => {
  const { agentIds, groupId } = await groupOf("メール", "株価");
  const [mail = "", stocks = ""] = agentIds;

  const sent = await userAgent().post(groupId, { text: "今日の予定は？" });
  scriptedModel.push(reply("一つ目。"), reply("二つ目。"));
  await runDurableObjectAlarm(userAgent());
  await runDurableObjectAlarm(userAgent());
  const replies = new Map(
    (await userAgent().threadEntries(groupId, 10))?.flatMap((entry) =>
      entry.type === "run" ? [[entry.run.agentId, entry.run.messages.at(-1)]] : [],
    ),
  );
  const endOrder = (await userAgent().threadEntries(groupId, 10))
    ?.flatMap((entry) => (entry.type === "run" ? [entry.run] : []))
    .toSorted((a, b) => (a.endedAt?.getTime() ?? 0) - (b.endedAt?.getTime() ?? 0))
    .map((run) => run.agentId);
  scriptedModel.push(reply("了解。"));
  await userAgent().post(groupId, { text: "@株価 詳しく" });
  await runDurableObjectAlarm(userAgent());

  expect(sent?.ok && sent.runs.map((run) => run.agentId).toSorted(byText)).toEqual(
    agentIds.toSorted(byText),
  );
  // Neither reply read the other: both were asked the post alone.
  expect(modelRequests.slice(0, 2).map((request) => request.messages)).toEqual([
    [{ role: "user", text: "今日の予定は？" }],
    [{ role: "user", text: "今日の予定は？" }],
  ]);
  const mailReply = replies.get(mail);
  const mailText =
    mailReply?.role === "assistant" && mailReply.parts[0]?.type === "text"
      ? mailReply.parts[0].text
      : "";
  const fromMail = { role: "user", text: `メール: ${mailText}` };
  const ownReply = replies.get(stocks);
  expect(modelRequests[2]?.messages).toEqual([
    { role: "user", text: "今日の予定は？" },
    ...(endOrder?.[0] === mail ? [fromMail, ownReply] : [ownReply, fromMail]),
    { role: "user", text: "@株価 詳しく" },
  ]);
});

test("runs that reply to one post are all next in line before either ends", async () => {
  const { groupId } = await groupOf("メール", "株価");
  const sent = await userAgent().post(groupId, { text: "今日の予定は？" });
  if (sent === undefined || !sent.ok) {
    throw new Error("The post was refused.");
  }

  const later = await userAgent().post(groupId, { text: "@メール ほかには？" });
  const inLine = await runInDurableObject(userAgent(), (_, state) => {
    const now = new Date(Date.now() + 1000);
    const first = store.nextDueRun(state.storage, now);
    store.endRun(state.storage, first ?? "", now);
    const second = store.nextDueRun(state.storage, now);
    store.endRun(state.storage, second ?? "", now);
    return [first, second, store.nextDueRun(state.storage, now)];
  });

  expect(inLine.slice(0, 2).toSorted(byText)).toEqual(
    sent.runs.map((run) => run.id).toSorted(byText),
  );
  expect(inLine[2]).toBe(later?.ok ? later.runs[0]?.id : undefined);
});

test("a thread's entries are its posts and runs, the latest first, each post after its replies", async () => {
  const { groupId } = await groupOf("メール", "株価");
  const sent = await userAgent().post(groupId, { text: "@メール 今日は？" });
  if (sent === undefined || !sent.ok) {
    throw new Error("The post was refused.");
  }

  const entries = await userAgent().threadEntries(groupId, 10);

  expect(
    entries?.map((entry) => (entry.type === "post" ? entry.post.text : entry.run.agentId)),
  ).toEqual([sent.runs[0]?.agentId, "@メール 今日は？"]);
  expect(await userAgent().threadEntries(crypto.randomUUID(), 10)).toBeUndefined();
});
