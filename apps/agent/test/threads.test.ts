import type { AssistantMessage, ModelRequest } from "@iris/agent";
import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import { RunBroadcast } from "../src/run-broadcast";
import { runDue, Waker } from "../src/runner";
import * as store from "../src/store";
import { listen } from "./run-events";
import { modelRequests, scriptedModel, testAgent } from "./worker";

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

/** Sorts `[name, …]` rows by name. */
const byName = (a: readonly unknown[], b: readonly unknown[]) =>
  String(a[0]).localeCompare(String(b[0]));

test("the home lists one-to-one threads and groups together, the latest activity first", async () => {
  const { agentIds, groupId } = await groupOf("メール", "株価");
  const [first] = await userAgent().listAgents();
  const firstThread = (await userAgent().listThreads()).find(
    (thread) => thread.agentId === first?.id,
  );
  await userAgent().sendMessage(first?.id ?? "", { text: "Hi" });

  const threads = await userAgent().listThreads();

  // The agents and the group are often made in the same millisecond and then tie; the sent message
  // puts the first agent's thread on top.
  expect(threads[0]).toMatchObject({ name: "エージェント", agentIds: [first?.id] });
  expect(
    threads
      .slice(1)
      .map((thread) => [thread.name, thread.agentIds.toSorted()])
      .toSorted(byName),
  ).toEqual(
    [
      ["チーム", agentIds.toSorted()],
      ["メール", [agentIds[0]]],
      ["株価", [agentIds[1]]],
    ].toSorted(byName),
  );
  expect(threads[0]?.id).toBe(firstThread?.id);
  expect(threads.find((thread) => thread.id === groupId)).toMatchObject({ agentId: null });
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
    // As the thread reads them: by when they ended, then by ID.
    .toSorted(
      (a, b) =>
        (a.endedAt?.getTime() ?? 0) - (b.endedAt?.getTime() ?? 0) || a.id.localeCompare(b.id),
    )
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

/** A time on one morning, by its minute. */
const at = (minute: number) => new Date(Date.UTC(2026, 10, 10, 8, minute));

test("a post is read together with its replies, and passed over when none ended with one", async () => {
  const [first] = await userAgent().listAgents();
  const agentId = first?.id ?? "";
  const read = await runInDurableObject(userAgent(), (_, state) => {
    const threadId = store.agentThreadId(state.storage, agentId) ?? "";
    const send = (id: string, text: string, minute: number) =>
      store.insertPost(state.storage, { id, threadId, text, createdAt: at(minute) }, [agentId]);
    const [answered = ""] = send("answered", "X", 0);
    store.appendMessage(state.storage, answered, 1, reply("Answer to X."));
    store.endRun(state.storage, answered, at(1));
    const [givenUp = ""] = send("given-up", "Y", 2);
    store.giveUpRun(state.storage, givenUp, at(3));
    const [current = ""] = send("current", "Z", 4);
    return [...store.earlierInThread(state.storage, current)];
  });

  expect(read).toEqual([[{ role: "user", text: "X" }, reply("Answer to X.")]]);
});

test("a group's replies to one post ask the model side by side, and a socket hears each one's progress", async () => {
  const { groupId } = await groupOf("メール", "株価");
  const { promise: bothAsked, resolve: release } = Promise.withResolvers<void>();
  const waitForBoth = async (request: ModelRequest) => {
    request.onProgress?.({ type: "thinking" });
    if (modelRequests.length === 2) {
      release();
    }
    await bothAsked;
    return reply("はい。");
  };
  scriptedModel.push(waitForBoth, waitForBoth);
  const heard = await runInDurableObject(userAgent(), async (instance, state) => {
    const broadcast = new RunBroadcast(state);
    const { 0: client, 1: server } = new WebSocketPair();
    broadcast.accept(groupId, server, "runs-and-posts");
    const socket = listen(client);
    await instance.post(groupId, { text: "今日は？" });
    await runDue(state.storage, testAgent, () => new Date(Date.now() + 1000), broadcast);
    return socket.events;
  });

  expect(modelRequests).toHaveLength(2);
  const thinking = heard.filter(
    (event) => event.type === "progress" && event.progress.type === "thinking",
  );
  expect(
    new Set(thinking.map((event) => (event.type === "progress" ? event.runId : ""))),
  ).toHaveProperty("size", 2);
});

test("a post sent while a wake-up carries runs on is started by that wake-up at once", async () => {
  const { groupId } = await groupOf("メール", "株価");
  const waker = new Waker();
  const { promise: firstAsked, resolve: firstStarted } = Promise.withResolvers<void>();
  const { promise: secondAsked, resolve: secondStarted } = Promise.withResolvers<void>();
  scriptedModel.push(
    async () => {
      firstStarted();
      await secondAsked;
      return reply("一つ目。");
    },
    () => {
      secondStarted();
      return reply("二つ目。");
    },
  );

  await runInDurableObject(userAgent(), async (_, state) => {
    await userAgent().post(groupId, { text: "@メール 一つ目" });
    const going = runDue(
      state.storage,
      testAgent,
      () => new Date(Date.now() + 1000),
      undefined,
      waker,
    );
    await firstAsked;
    const [first] = await userAgent().listAgents();
    await userAgent().sendMessage(first?.id ?? "", { text: "二つ目" });
    waker.wake();
    await going;
  });

  expect(modelRequests.map((request) => request.messages.at(-1))).toEqual([
    { role: "user", text: "@メール 一つ目" },
    { role: "user", text: "二つ目" },
  ]);
});
