import type { AssistantMessage } from "@iris/agent";
import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import { RETRY_DELAY_MS, runDue, WAKE_UP_BUDGET_MS } from "../src/runner";
import * as store from "../src/store";
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

const ask = (agent: string, question: string, id = "call-1"): AssistantMessage => ({
  role: "assistant",
  parts: [{ type: "tool-call", id, name: "ask_agent", input: { agent, question } }],
});

/** The first agent, and a second one named 株価; returns their IDs. */
async function twoAgents() {
  const [first] = await userAgent().listAgents();
  const added = await userAgent().addAgent({ name: "株価" });
  if (first === undefined || !added.ok) {
    throw new Error("The agents weren't there.");
  }
  return { asker: first.id, answerer: added.agent.id };
}

test("an agent asks another in a consult and carries on with the answer", async () => {
  const { asker, answerer } = await twoAgents();
  scriptedModel.push(
    ask("株価", "今日の株価は？"),
    reply("上がっています。"),
    reply("株価は上がっているそうです。"),
  );

  await userAgent().sendMessage(asker, { text: "株価を聞いてきて" });
  await runDurableObjectAlarm(userAgent());

  const [askerAsks, answererAnswers, askerCarriesOn] = modelRequests;
  expect(askerAsks?.tools.map((tool) => tool.name)).toEqual(["ask_agent"]);
  expect(answererAnswers?.messages).toEqual([
    { role: "user", text: "エージェント: 今日の株価は？" },
  ]);
  expect(answererAnswers?.tools).toEqual([]);
  expect(askerCarriesOn?.messages.at(-1)).toEqual({
    role: "tool",
    callId: "call-1",
    isError: false,
    content: "上がっています。",
  });
  const [run] = (await userAgent().recentRuns(asker)) ?? [];
  expect(run?.endedAt).not.toBeNull();
  expect(run?.messages.at(-1)).toEqual(reply("株価は上がっているそうです。"));

  const threads = await userAgent().listThreads();
  expect(threads.every((thread) => thread.name !== "")).toBe(true);
  const consult = await runInDurableObject(userAgent(), (_, state) =>
    store.findConsult(state.storage, run?.id ?? "", answerer),
  );
  expect(threads.map((thread) => thread.id)).not.toContain(consult);
  const entries = (await userAgent().threadEntries(consult ?? "", 10)) ?? [];
  expect(
    entries.map((entry) => (entry.type === "post" ? entry.post.agentId : entry.run.agentId)),
  ).toEqual([answerer, asker]);
  const refused = await userAgent().post(consult ?? "", { text: "割り込み" });
  expect(refused?.ok).toBe(false);
});

test("asking an agent that isn't there comes back as the tool's error, with who can be asked", async () => {
  const { asker } = await twoAgents();
  scriptedModel.push(ask("だれか", "いますか？"), reply("見つかりませんでした。"));

  await userAgent().sendMessage(asker, { text: "聞いてきて" });
  await runDurableObjectAlarm(userAgent());

  expect(modelRequests[1]?.messages.at(-1)).toEqual({
    role: "tool",
    callId: "call-1",
    isError: true,
    content: 'No agent is named "だれか". You can ask: 株価.',
  });
});

test("a run cut while it waits for an answer stops without failing and asks only once", async () => {
  const { asker } = await twoAgents();
  let clock = Date.now();
  scriptedModel.push(ask("株価", "今日の株価は？"), () => {
    // The answer fails, and the wake-up runs out of time while the asker waits.
    clock += WAKE_UP_BUDGET_MS;
    throw new Error("The model service is unreachable.");
  });
  // Put straight into storage, so no alarm of the object's own carries it on alongside the test.
  await runInDurableObject(userAgent(), (_, state) => {
    store.insertPost(
      state.storage,
      {
        id: crypto.randomUUID(),
        threadId: store.agentThreadId(state.storage, asker) ?? "",
        agentId: null,
        callId: null,
        text: "株価を聞いてきて",
        createdAt: new Date(clock),
      },
      [asker],
    );
  });

  await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => new Date(clock)),
  );

  const [cut] = (await userAgent().recentRuns(asker)) ?? [];
  expect(cut?.endedAt).toBeNull();
  expect(cut?.failedAttempts).toBe(0);

  clock += RETRY_DELAY_MS;
  scriptedModel.push(reply("上がっています。"), reply("上がっているそうです。"));
  await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => new Date(clock)),
  );

  const [answered] = (await userAgent().recentRuns(asker)) ?? [];
  expect(answered?.messages.at(-1)).toEqual(reply("上がっているそうです。"));
  const questions = await runInDurableObject(userAgent(), (_, state) =>
    state.storage.sql.exec("SELECT count(*) AS asked FROM posts WHERE call_id IS NOT NULL").one(),
  );
  expect(questions).toEqual({ asked: 1 });
});

test("an agent with no one to ask isn't offered the tool", async () => {
  const [only] = await userAgent().listAgents();
  scriptedModel.push(reply("はい。"));

  await userAgent().sendMessage(only?.id ?? "", { text: "Hi" });
  await runDurableObjectAlarm(userAgent());

  expect(modelRequests[0]?.tools).toEqual([]);
});
