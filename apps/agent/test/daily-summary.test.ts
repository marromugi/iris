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
import { dayOf } from "../src/day";
import { nextWakeAt, RETRY_DELAY_MS, runDue, Waker } from "../src/runner";
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

test("a post to another thread sent while summaries are being written gets its reply in the same wake-up", async () => {
  await exchange("おはよう", "おはようございます。", new Date("2026-11-12T09:00:00+09:00"));
  const added = await userAgent().addAgent({ name: "株価" });
  if (!added.ok) {
    throw new Error(added.error);
  }
  const agentId = added.agent.id;
  const threadId = await runInDurableObject(userAgent(), (_, state) =>
    agentThread(state.storage, agentId),
  );
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

/** Saves the first agent's thread's summary of the Tokyo day labelled `label`: `text`, or failed for good when null. */
async function summarized(label: string, text: string | null) {
  const { threadId } = await firstAgent();
  const day = dayOf(new Date(`${label}T12:00:00+09:00`), "Asia/Tokyo");
  const row = { threadId, day: day.label, startsAt: day.startsAt, endsAt: day.endsAt };
  await runInDurableObject(userAgent(), (_, state) => {
    if (text !== null) {
      store.saveDailySummary(state.storage, { ...row, text });
      return;
    }
    for (let attempt = 0; attempt < MAX_SUMMARY_ATTEMPTS; attempt += 1) {
      store.recordDailySummaryFailure(state.storage, row, { error: "busy", retryAt: day.endsAt });
    }
  });
}

/** One wake-up at `now`, as the alarm does it: due runs, and due summaries side by side. */
function wakeUpAt(now: Date) {
  return runInDurableObject(userAgent(), async (_, state) => {
    const waker = new Waker();
    return runDue(
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
        () => waker.wake(),
      ),
    );
  });
}

/** The summaries at the end of a run's system prompt, as `[date, text]`, oldest first. */
const summariesIn = (system: string | undefined) =>
  [...(system ?? "").matchAll(/<day date="([^"]+)">\n([\s\S]*?)\n<\/day>/g)].map(
    ([, day, text]) => [day, text],
  );

test("a run reads what was said in its thread only from 4:00 of its day", async () => {
  await exchange("夜ふかし中", "早めに寝ましょう。", new Date("2026-11-13T03:59:00+09:00"));
  await summarized("2026-11-12", "12日のまとめ");
  await exchange("おはよう", "おはようございます。", new Date("2026-11-13T04:00:00+09:00"));
  await exchange("今日の予定は？", undefined, new Date("2026-11-13T09:00:00+09:00"));
  scriptedModel.push(reply("10 時から会議です。"));

  await wakeUpAt(new Date("2026-11-13T09:00:00+09:00"));

  expect(modelRequests[0]?.messages).toEqual([
    { role: "user", text: "おはよう" },
    reply("おはようございます。"),
    { role: "user", text: "今日の予定は？" },
  ]);
});

test("a run is told its thread's written summaries of the 7 days before its own, oldest first, and keeps them when carried on", async () => {
  await summarized("2026-11-05", "8日前");
  await summarized("2026-11-06", "7日前");
  await summarized("2026-11-09", null);
  await summarized("2026-11-12", "昨日");
  await summarized("2026-11-10", "3日前");
  await exchange("続きを", undefined, new Date("2026-11-13T09:00:00+09:00"));
  scriptedModel.push(new Error("The model service is unreachable."), reply("はい。"));

  await wakeUpAt(new Date("2026-11-13T09:00:00+09:00"));
  await wakeUpAt(new Date(new Date("2026-11-13T09:00:00+09:00").getTime() + RETRY_DELAY_MS));

  const [first, carriedOn] = modelRequests;
  expect(summariesIn(first?.system)).toEqual([
    ["2026-11-06", "7日前"],
    ["2026-11-10", "3日前"],
    ["2026-11-12", "昨日"],
  ]);
  expect(first?.system).toMatch(
    /Model: test-model\.\n\nThe conversation leaves out this thread's earlier days, each from 4:00 to 4:00 in the user's time zone\. Their summaries, oldest first:\n\n<day date="2026-11-06">/,
  );
  expect(carriedOn?.system).toBe(first?.system);
});

test("a run with no summaries to read gets the prompt it had before", async () => {
  await exchange("こんにちは", undefined, new Date("2026-11-13T09:00:00+09:00"));
  scriptedModel.push(reply("こんにちは！"));

  await wakeUpAt(new Date("2026-11-13T09:00:00+09:00"));

  expect(modelRequests[0]?.system).toMatch(/Model: test-model\.$/);
});

test("a run that started after a day ended waits for that day's summary, and reads it", async () => {
  await exchange("買い物リスト", "牛乳、卵", new Date("2026-11-12T10:00:00+09:00"));
  await exchange("リストは？", undefined, new Date("2026-11-13T04:01:00+09:00"));
  scriptedModel.push(reply("12日のまとめ"), reply("牛乳と卵です。"));

  await wakeUpAt(new Date("2026-11-13T04:01:00+09:00"));

  const [summary, run] = modelRequests;
  expect(summary?.system).toBe(SUMMARY_PROMPT);
  expect(summariesIn(run?.system)).toEqual([["2026-11-12", "12日のまとめ"]]);
  expect(run?.messages).toEqual([{ role: "user", text: "リストは？" }]);
});

test("a run waits while its thread's summary of an earlier day is being tried again", async () => {
  await exchange("買い物リスト", "牛乳、卵", new Date("2026-11-12T10:00:00+09:00"));
  scriptedModel.push(new Error("The model is busy."));
  await summarizeAt(new Date("2026-11-13T04:00:00+09:00"));
  await exchange("リストは？", undefined, new Date("2026-11-13T04:01:00+09:00"));

  const wakeAgainAt = await wakeUpAt(new Date("2026-11-13T04:01:00+09:00"));
  expect(modelRequests).toHaveLength(1);
  const retryAt = new Date(
    new Date("2026-11-13T04:00:00+09:00").getTime() + SUMMARY_RETRY_DELAY_MS,
  );
  expect(wakeAgainAt).toEqual(retryAt);

  scriptedModel.push(reply("12日のまとめ"), reply("牛乳と卵です。"));
  await wakeUpAt(retryAt);
  expect(summariesIn(modelRequests[2]?.system)).toEqual([["2026-11-12", "12日のまとめ"]]);
});

test("a run started before the day ended goes first, then the summary, then a run started after", async () => {
  await exchange("調べて", undefined, new Date("2026-11-13T03:58:00+09:00"));
  await exchange("終わった？", undefined, new Date("2026-11-13T04:01:00+09:00"));
  scriptedModel.push(reply("調べました。"), reply("12日のまとめ"), reply("終わりました。"));

  // The summary can be written only once the earlier run has ended, so the wake-up asks to be
  // woken again at once, when the summary is due.
  const now = new Date("2026-11-13T04:01:00+09:00");
  expect(await wakeUpAt(now)).toEqual(new Date("2026-11-13T04:00:00+09:00"));
  expect(modelRequests).toHaveLength(1);
  await wakeUpAt(new Date(now.getTime() + 1000));

  expect(modelRequests.map((request) => request.system === SUMMARY_PROMPT)).toEqual([
    false,
    true,
    false,
  ]);
  expect(summariesIn(modelRequests[0]?.system)).toEqual([]);
  expect(summariesIn(modelRequests[2]?.system)).toEqual([["2026-11-12", "12日のまとめ"]]);
});

test("a run starts once its own thread's summary is written, while other threads' are still being written", async () => {
  const added = await userAgent().addAgent({ name: "株価" });
  if (!added.ok) {
    throw new Error(added.error);
  }
  const other = added.agent.id;
  await runInDurableObject(userAgent(), (_, state) => {
    const threadId = agentThread(state.storage, other);
    const said = (text: string, at: Date) =>
      store.insertPost(
        state.storage,
        { id: crypto.randomUUID(), threadId, agentId: null, callId: null, text, createdAt: at },
        [other],
      );
    const [runId = ""] = said("株価は？", new Date("2026-11-12T10:00:00+09:00"));
    store.appendMessage(state.storage, runId, 1, reply("上がっています。"));
    store.endRun(state.storage, runId, new Date("2026-11-12T10:01:00+09:00"));
    said("今日は？", new Date("2026-11-13T04:01:00+09:00"));
  });
  await exchange("買い物リスト", "牛乳、卵", new Date("2026-11-12T10:00:00+09:00"));
  await exchange("リストは？", undefined, new Date("2026-11-13T04:01:00+09:00"));
  const { promise: runAsked, resolve: runStarted } = Promise.withResolvers<void>();
  const tooLate = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("The run didn't start before the next summary.")), 2000),
  );
  scriptedModel.push(
    reply("一つ目のまとめ"),
    async () => {
      await Promise.race([runAsked, tooLate]);
      return reply("二つ目のまとめ");
    },
    () => {
      runStarted();
      return reply("はい。");
    },
    reply("はい。"),
  );

  await wakeUpAt(new Date("2026-11-13T04:01:00+09:00"));

  expect(modelRequests.map((request) => request.system === SUMMARY_PROMPT)).toEqual([
    true,
    true,
    false,
    false,
  ]);
  expect(summariesIn(modelRequests[2]?.system)).toEqual([["2026-11-12", "一つ目のまとめ"]]);
});

test("a consult is read whole, across 4:00, and gets no summaries", async () => {
  const added = await userAgent().addAgent({ name: "株価" });
  if (!added.ok) {
    throw new Error(added.error);
  }
  const answerer = added.agent.id;
  await exchange("株価を聞いてきて", undefined, new Date("2026-11-13T03:50:00+09:00"));
  const { agentId } = await firstAgent();
  await runInDurableObject(userAgent(), (_, state) => {
    const [asking] = store.recentRuns(state.storage, agentThread(state.storage, agentId), 1);
    const askingRunId = asking?.id ?? "";
    // The asking run waits for the answer; it isn't carried on here.
    store.postponeRun(state.storage, askingRunId, new Date("2026-11-14T00:00:00Z"));
    store.insertConsult(state.storage, {
      id: "consult-1",
      runId: askingRunId,
      askerId: agentId,
      answerer: { id: answerer, name: "株価" },
      createdAt: new Date("2026-11-13T03:59:00+09:00"),
    });
    const ask = (text: string, at: Date) =>
      store.insertPost(
        state.storage,
        {
          id: crypto.randomUUID(),
          threadId: "consult-1",
          agentId,
          callId: null,
          text,
          createdAt: at,
        },
        [answerer],
      );
    const [first = ""] = ask("今日は？", new Date("2026-11-13T03:59:00+09:00"));
    store.appendMessage(state.storage, first, 1, reply("上がっています。"));
    store.endRun(state.storage, first, new Date("2026-11-13T04:00:30+09:00"));
    ask("いくら？", new Date("2026-11-13T04:01:00+09:00"));
  });
  scriptedModel.push(reply("100 円です。"));

  await wakeUpAt(new Date("2026-11-13T04:01:00+09:00"));

  expect(modelRequests[0]?.messages).toEqual([
    { role: "user", text: "エージェント: 今日は？" },
    reply("上がっています。"),
    { role: "user", text: "エージェント: いくら？" },
  ]);
  expect(summariesIn(modelRequests[0]?.system)).toEqual([]);
});
