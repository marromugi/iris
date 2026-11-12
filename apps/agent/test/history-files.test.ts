import type { AssistantMessage } from "@iris/agent";
import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import { MAX_SUMMARY_ATTEMPTS, SUMMARY_RETRY_DELAY_MS, summarizeDue } from "../src/daily-summary";
import * as store from "../src/store";
import { agentThread } from "./agent-thread";
import { scriptedModel, testAgent } from "./worker";

afterEach(async () => {
  scriptedModel.length = 0;
  await reset();
});

const userAgent = () => env.USER_AGENT.getByName("user-1");

const reply = (text: string): AssistantMessage => ({
  role: "assistant",
  parts: [{ type: "text", text }],
});

const MINUTE_MS = 60 * 1000;

async function firstAgentId(): Promise<string> {
  const [first] = await userAgent().listAgents();
  if (first === undefined) {
    throw new Error("The user has no agent.");
  }
  return first.id;
}

/**
 * Puts the user's post in the thread at `at` straight into storage, with a reply from each of
 * `answers`' agents a minute later.
 */
async function exchange(threadId: string, text: string, answers: [string, string][], at: Date) {
  await runInDurableObject(userAgent(), (_, state) => {
    const runIds = store.insertPost(
      state.storage,
      { id: crypto.randomUUID(), threadId, agentId: null, callId: null, text, createdAt: at },
      answers.map(([agentId]) => agentId),
    );
    for (const [index, runId] of runIds.entries()) {
      store.appendMessage(state.storage, runId, 1, reply(answers[index]?.[1] ?? ""));
      store.endRun(state.storage, runId, new Date(at.getTime() + MINUTE_MS));
    }
  });
}

/** Writes the summaries due at `now`, and returns the files kept, by key. */
async function summarizeAt(now: Date): Promise<Record<string, string>> {
  const kept: Record<string, string> = {};
  await runInDurableObject(userAgent(), (_, state) =>
    summarizeDue(
      state.storage,
      testAgent.model,
      () => now,
      () => false,
      () => {},
      async (key, text) => {
        kept[key] = text;
      },
    ),
  );
  return kept;
}

test("the alarm writes the day's summary and what was said into the agent's workspace", async () => {
  const agentId = await firstAgentId();
  const threadId = await runInDurableObject(userAgent(), (_, state) =>
    agentThread(state.storage, agentId),
  );
  await exchange(
    threadId,
    "こんにちは",
    [[agentId, "こんにちは！"]],
    new Date("2026-01-05T12:00:00+09:00"),
  );
  scriptedModel.push(reply("挨拶をした。"));
  await runInDurableObject(userAgent(), (_, state) => state.storage.setAlarm(Date.now()));

  await runDurableObjectAlarm(userAgent());

  const heading =
    "Day: 2026-01-05 (Asia/Tokyo)\nThread: one-to-one between the user and エージェント";
  const summary = await env.WORKSPACES.get(`agents/${agentId}/history/2026-01-05.md`);
  const said = await env.WORKSPACES.get(`agents/${agentId}/history/2026-01-05.log.md`);
  expect(await summary?.text()).toBe(`${heading}\n\n挨拶をした。\n`);
  expect(await said?.text()).toBe(
    `${heading}\n\n[12:00] User: こんにちは\n[12:01] エージェント: こんにちは！\n`,
  );
});

test("a group's day goes into each member's workspace, under the group's own directory", async () => {
  const first = await firstAgentId();
  const added = await userAgent().addAgent({ name: "株価" });
  if (!added.ok) {
    throw new Error(added.error);
  }
  const second = added.agent.id;
  const group = await userAgent().addGroup({ name: "旅行", agentIds: [first, second] });
  if (!group.ok) {
    throw new Error(group.error);
  }
  const threadId = group.thread.id;
  await exchange(
    threadId,
    "京都どう？",
    [
      [first, "紅葉がきれいです。"],
      [second, "混雑に注意。"],
    ],
    new Date("2026-11-12T10:00:00+09:00"),
  );
  scriptedModel.push(reply("京都の相談をした。"));

  const kept = await summarizeAt(new Date("2026-11-13T04:00:00+09:00"));

  expect(Object.keys(kept).toSorted()).toEqual(
    [first, second]
      .flatMap((agentId) => [
        `agents/${agentId}/history/groups/${threadId}/2026-11-12.log.md`,
        `agents/${agentId}/history/groups/${threadId}/2026-11-12.md`,
      ])
      .toSorted(),
  );
  expect(kept[`agents/${first}/history/groups/${threadId}/2026-11-12.md`]).toBe(
    'Day: 2026-11-12 (Asia/Tokyo)\nThread: group "旅行"\n\n京都の相談をした。\n',
  );
});

test("a day whose summary is passed over keeps only what was said", async () => {
  const agentId = await firstAgentId();
  const threadId = await runInDurableObject(userAgent(), (_, state) =>
    agentThread(state.storage, agentId),
  );
  await exchange(
    threadId,
    "買い物リスト",
    [[agentId, "牛乳、卵"]],
    new Date("2026-11-12T10:00:00+09:00"),
  );
  const failAt = new Date("2026-11-13T04:00:00+09:00");

  const kept: Record<string, string>[] = [];
  for (let attempt = 0; attempt < MAX_SUMMARY_ATTEMPTS; attempt += 1) {
    scriptedModel.push(new Error("The model is busy."));
    kept.push(await summarizeAt(new Date(failAt.getTime() + attempt * SUMMARY_RETRY_DELAY_MS)));
  }

  expect(kept.slice(0, -1)).toEqual(kept.slice(0, -1).map(() => ({})));
  expect(Object.keys(kept.at(-1) ?? {})).toEqual([`agents/${agentId}/history/2026-11-12.log.md`]);
});

test("a file that can't be written leaves the summary stored and the other files written", async () => {
  const agentId = await firstAgentId();
  const threadId = await runInDurableObject(userAgent(), (_, state) =>
    agentThread(state.storage, agentId),
  );
  await exchange(
    threadId,
    "おはよう",
    [[agentId, "おはようございます。"]],
    new Date("2026-11-12T08:00:00+09:00"),
  );
  scriptedModel.push(reply("挨拶をした。"));
  const kept: string[] = [];

  await runInDurableObject(userAgent(), (_, state) =>
    summarizeDue(
      state.storage,
      testAgent.model,
      () => new Date("2026-11-13T04:00:00+09:00"),
      () => false,
      () => {},
      async (key) => {
        if (key.endsWith(".log.md")) {
          throw new Error("R2 is down.");
        }
        kept.push(key);
      },
    ),
  );

  expect(kept).toEqual([`agents/${agentId}/history/2026-11-12.md`]);
  expect(
    await runInDurableObject(userAgent(), (_, state) =>
      store.dailySummariesOf(state.storage, threadId).map((summary) => summary.text),
    ),
  ).toEqual(["挨拶をした。"]);
});
