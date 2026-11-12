import type { AssistantMessage } from "@iris/agent";
import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import {
  MAX_SUMMARY_ATTEMPTS,
  nextSummaryDueAt,
  SUMMARY_PROMPT,
  SUMMARY_RETRY_DELAY_MS,
  summarizeDue,
} from "../src/daily-summary";
import { nextWakeAt, runDue, Waker } from "../src/runner";
import * as store from "../src/store";
import { agentThread } from "./agent-thread";
import { modelRequests, scriptedModel, testAgent } from "./worker";

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

const MINUTE_MS = 60 * 1000;

/** The ID of the agent every user starts with, and its one-to-one thread. */
async function firstAgent(): Promise<{ agentId: string; threadId: string }> {
  const [first] = await userAgent().listAgents();
  if (first === undefined) {
    throw new Error("The user has no agent.");
  }
  return runInDurableObject(userAgent(), (_, state) => ({
    agentId: first.id,
    threadId: agentThread(state.storage, first.id),
  }));
}

/**
 * Puts the user's post at `at` straight into storage with the agent's run replying to it, which
 * ends with `answer` a minute later, or is still going when `answer` is undefined.
 */
async function exchange(text: string, answer: string | undefined, at: Date) {
  const { agentId, threadId } = await firstAgent();
  await runInDurableObject(userAgent(), (_, state) => {
    const [runId] = store.insertPost(
      state.storage,
      { id: crypto.randomUUID(), threadId, agentId: null, callId: null, text, createdAt: at },
      [agentId],
    );
    if (runId === undefined || answer === undefined) {
      return;
    }
    store.appendMessage(state.storage, runId, 1, reply(answer));
    store.endRun(state.storage, runId, new Date(at.getTime() + MINUTE_MS));
  });
}

/** Puts a run a task started at `at` straight into storage, which ends with `answer` a minute later. */
async function taskRun(prompt: string, answer: string, at: Date) {
  const { agentId, threadId } = await firstAgent();
  await runInDurableObject(userAgent(), (_, state) => {
    const runId = crypto.randomUUID();
    store.startRun(state.storage, {
      id: runId,
      agentId,
      threadId,
      text: prompt,
      startedAt: at,
      task: { id: "task-1", nextRunAt: at },
    });
    store.appendMessage(state.storage, runId, 1, reply(answer));
    store.endRun(state.storage, runId, new Date(at.getTime() + MINUTE_MS));
  });
}

function summarizeAt(now: Date) {
  return runInDurableObject(userAgent(), (_, state) =>
    summarizeDue(
      state.storage,
      testAgent.model,
      () => now,
      () => false,
    ),
  );
}

async function summaries() {
  const { threadId } = await firstAgent();
  return runInDurableObject(userAgent(), (_, state) =>
    store.dailySummariesOf(state.storage, threadId).map(({ day, text }) => ({ day, text })),
  );
}

function wakeAt() {
  return runInDurableObject(userAgent(), (_, state) => nextWakeAt(state.storage));
}

test("a thread's day is summarized from what was said once it ends at 4:00 in Tokyo", async () => {
  await exchange("今日の天気は？", "晴れ、最高 14℃ です。", new Date("2026-11-12T10:00:00+09:00"));
  expect(await wakeAt()).toEqual(new Date("2026-11-13T04:00:00+09:00"));

  await summarizeAt(new Date("2026-11-13T03:59:00+09:00"));
  expect(modelRequests).toEqual([]);

  scriptedModel.push(reply("## 頼まれたこと・やったこと\n- 天気を伝えた。"));
  await summarizeAt(new Date("2026-11-13T04:00:00+09:00"));

  expect(modelRequests).toEqual([
    {
      system: SUMMARY_PROMPT,
      tools: [],
      messages: [
        {
          role: "user",
          text: [
            "Day: 2026-11-12 (Asia/Tokyo)",
            "Thread: one-to-one between the user and エージェント",
            "",
            "[10:00] User: 今日の天気は？",
            "[10:01] エージェント: 晴れ、最高 14℃ です。",
          ].join("\n"),
        },
      ],
    },
  ]);
  expect(await summaries()).toEqual([
    { day: "2026-11-12", text: "## 頼まれたこと・やったこと\n- 天気を伝えた。" },
  ]);
  expect(await wakeAt()).toBeUndefined();
});

test("each day something was said on gets its own summary, and a quiet day none", async () => {
  await exchange("朝ごはんは？", "トーストです。", new Date("2026-11-12T08:00:00+09:00"));
  await exchange("夜ふかし中", "早めに寝ましょう。", new Date("2026-11-13T03:30:00+09:00"));
  await exchange("おはよう", "おはようございます。", new Date("2026-11-14T04:00:00+09:00"));
  await taskRun("天気を教えて", "晴れです。", new Date("2026-11-14T07:00:00+09:00"));
  scriptedModel.push(reply("12日のまとめ"), reply("14日のまとめ"));

  await summarizeAt(new Date("2026-11-15T05:00:00+09:00"));

  expect(await summaries()).toEqual([
    { day: "2026-11-12", text: "12日のまとめ" },
    { day: "2026-11-14", text: "14日のまとめ" },
  ]);
  const [twelfth, fourteenth] = modelRequests.map((request) => request.messages[0]);
  expect(twelfth).toMatchObject({ text: expect.stringContaining("[03:30] User: 夜ふかし中") });
  expect(twelfth).not.toMatchObject({ text: expect.stringContaining("おはよう") });
  expect(fourteenth).toMatchObject({
    text: expect.stringContaining(
      [
        "[04:00] User: おはよう",
        "[04:01] エージェント: おはようございます。",
        "[07:00] Task for エージェント: 天気を教えて",
        "[07:01] エージェント: 晴れです。",
      ].join("\n"),
    ),
  });
});

test("a consult gets no summary", async () => {
  const { agentId } = await firstAgent();
  await runInDurableObject(userAgent(), (_, state) => {
    const at = new Date("2026-11-12T10:00:00+09:00");
    store.insertConsult(state.storage, {
      id: "consult-1",
      runId: "run-1",
      askerId: agentId,
      answerer: { id: "answerer-1", name: "相談相手" },
      createdAt: at,
    });
    const [answerRunId] = store.insertPost(
      state.storage,
      {
        id: "post-1",
        threadId: "consult-1",
        agentId,
        callId: "call-1",
        text: "教えて",
        createdAt: at,
      },
      ["answerer-1"],
    );
    store.appendMessage(state.storage, answerRunId ?? "", 1, reply("どうぞ"));
    store.endRun(state.storage, answerRunId ?? "", at);
  });

  await summarizeAt(new Date("2026-11-14T04:00:00+09:00"));

  expect(modelRequests).toEqual([]);
});

test("summaries stop being written once the wake-up runs out of time", async () => {
  await exchange("こんにちは", "こんにちは！", new Date("2026-11-12T10:00:00+09:00"));

  await runInDurableObject(userAgent(), (_, state) =>
    summarizeDue(
      state.storage,
      testAgent.model,
      () => new Date("2026-11-14T04:00:00+09:00"),
      () => true,
    ),
  );

  expect(modelRequests).toEqual([]);
});

test("a day's summary waits for a run of that day that is still going", async () => {
  await exchange("調べて", undefined, new Date("2026-11-13T03:58:00+09:00"));

  await summarizeAt(new Date("2026-11-13T04:30:00+09:00"));
  expect(modelRequests).toEqual([]);
  expect(await runInDurableObject(userAgent(), (_, state) => nextSummaryDueAt(state.storage))).toBe(
    undefined,
  );

  await runInDurableObject(userAgent(), (_, state) => {
    const [run] = store.recentRuns(state.storage, store.listThreads(state.storage)[0]?.id ?? "", 1);
    store.appendMessage(state.storage, run?.id ?? "", 1, reply("調べました。"));
    store.endRun(state.storage, run?.id ?? "", new Date("2026-11-13T04:31:00+09:00"));
  });
  // A run that started after the day ended doesn't hold up its summary.
  await exchange("もう一つ", undefined, new Date("2026-11-13T04:20:00+09:00"));
  scriptedModel.push(reply("まとめ"));
  await summarizeAt(new Date("2026-11-13T04:31:00+09:00"));

  expect(await summaries()).toEqual([{ day: "2026-11-12", text: "まとめ" }]);
  expect(modelRequests[0]?.messages[0]).toMatchObject({
    text: expect.stringContaining("[04:31] エージェント: 調べました。"),
  });
});

test("a failed summary is tried again later, and its day is passed over once it keeps failing", async () => {
  await exchange("買い物リスト", "牛乳、卵", new Date("2026-11-12T10:00:00+09:00"));
  await exchange("また明日", "おやすみなさい", new Date("2026-11-13T22:00:00+09:00"));
  const failAt = new Date("2026-11-13T04:00:00+09:00");

  for (let attempt = 0; attempt < MAX_SUMMARY_ATTEMPTS; attempt += 1) {
    // An empty summary fails like an error does.
    scriptedModel.push(attempt === 0 ? reply("  ") : new Error("The model is busy."));
    const now = new Date(failAt.getTime() + attempt * SUMMARY_RETRY_DELAY_MS);
    await summarizeAt(now);
    expect(modelRequests).toHaveLength(attempt + 1);
    expect(await wakeAt()).toEqual(
      attempt + 1 < MAX_SUMMARY_ATTEMPTS
        ? new Date(now.getTime() + SUMMARY_RETRY_DELAY_MS)
        : new Date("2026-11-14T04:00:00+09:00"),
    );
  }
  expect(await summaries()).toEqual([{ day: "2026-11-12", text: null }]);

  scriptedModel.push(reply("13日のまとめ"));
  await summarizeAt(new Date("2026-11-14T04:00:00+09:00"));

  expect(await summaries()).toEqual([
    { day: "2026-11-12", text: null },
    { day: "2026-11-13", text: "13日のまとめ" },
  ]);
});

test("the user's time zone sets where their days end, and an unknown one is refused", async () => {
  await exchange("Lunch ideas?", "Soup.", new Date("2026-11-12T12:00:00-05:00"));

  expect(await userAgent().setTimeZone("Mars/Olympus")).toMatchObject({ ok: false });
  expect(await userAgent().setTimeZone("America/New_York")).toEqual({ ok: true });

  const newYorkMorning = new Date("2026-11-13T04:00:00-05:00");
  expect(await wakeAt()).toEqual(newYorkMorning);
  expect(await runInDurableObject(userAgent(), (_, state) => state.storage.getAlarm())).toBe(
    newYorkMorning.getTime(),
  );
});

test("the alarm writes the summaries that are due, and sets no alarm when nothing waits", async () => {
  await exchange("こんにちは", "こんにちは！", new Date("2026-01-05T12:00:00+09:00"));
  scriptedModel.push(reply("挨拶をした。"));
  await runInDurableObject(userAgent(), (_, state) => state.storage.setAlarm(Date.now()));

  expect(await runDurableObjectAlarm(userAgent())).toBe(true);

  expect(await summaries()).toEqual([{ day: "2026-01-05", text: "挨拶をした。" }]);
  expect(await runInDurableObject(userAgent(), (_, state) => state.storage.getAlarm())).toBeNull();
});

test("a post sent while summaries are being written gets its reply in the same wake-up", async () => {
  await exchange("おはよう", "おはようございます。", new Date("2026-11-12T09:00:00+09:00"));
  const { agentId, threadId } = await firstAgent();
  const now = new Date("2026-11-13T08:00:00+09:00");
  const { promise: replied, resolve: reply_ } = Promise.withResolvers<void>();
  const tooLate = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("The post's run didn't start.")), 2000),
  );
  const waker = new Waker();

  await runInDurableObject(userAgent(), async (_, state) => {
    scriptedModel.push(
      async () => {
        store.insertPost(
          state.storage,
          {
            id: "post-2",
            threadId,
            agentId: null,
            callId: null,
            text: "今日の予定は？",
            createdAt: now,
          },
          [agentId],
        );
        waker.wake();
        await Promise.race([replied, tooLate]);
        return reply("まとめ");
      },
      () => {
        reply_();
        return reply("10 時から会議です。");
      },
    );
    await runDue(
      state.storage,
      testAgent,
      () => now,
      undefined,
      waker,
      undefined,
      summarizeDue(
        state.storage,
        testAgent.model,
        () => now,
        () => false,
      ),
    );
  });

  expect(await summaries()).toEqual([{ day: "2026-11-12", text: "まとめ" }]);
  expect(modelRequests).toHaveLength(2);
});
