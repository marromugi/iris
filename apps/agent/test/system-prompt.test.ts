import type { AssistantMessage, ModelRequest } from "@iris/agent";
import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import { RETRY_DELAY_MS, runDue } from "../src/runner";
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

/** The last line of the request's system prompt, which says when and where the run is. */
const placeOf = (request: ModelRequest | undefined) => request?.system?.split("\n").at(-1);

async function addAgent(name: string): Promise<string> {
  const added = await userAgent().addAgent({ name });
  if (!added.ok) {
    throw new Error(added.error);
  }
  return added.agent.id;
}

test("each run is told who it is and where, the shared prompt first", async () => {
  const [first] = await userAgent().listAgents();
  const stocks = await addAgent("株価");
  scriptedModel.push(
    {
      role: "assistant",
      parts: [
        {
          type: "tool-call",
          id: "call-1",
          name: "ask_agent",
          input: { agent: "株価", question: "今日は？" },
        },
      ],
    },
    reply("上がっています。"),
    reply("上がっているそうです。"),
  );

  await userAgent().sendMessage(first?.id ?? "", { text: "株価を聞いてきて" });
  await runDurableObjectAlarm(userAgent());

  const [asking, answering] = modelRequests;
  expect(asking?.system).toMatch(/^You are エージェント, one of the user's agents in iris\./);
  const today = new Date().toISOString().slice(0, "YYYY-MM-DD".length);
  expect(placeOf(asking)).toBe(
    `This run started on ${today} (UTC); it may be later now, so check with \`date\` when the time matters. Thread: one-to-one with the user. Model: test-model.`,
  );
  expect(answering?.system).toMatch(/^You are 株価,/);
  expect(placeOf(answering)).toMatch(
    /Thread: consult, where エージェント is asking you\. Model: test-model\.$/,
  );

  modelRequests.length = 0;
  const group = await userAgent().addGroup({ name: "チーム", agentIds: [first?.id ?? "", stocks] });
  if (!group.ok) {
    throw new Error(group.error);
  }
  scriptedModel.push(reply("はい。"));
  await userAgent().post(group.thread.id, { text: "@株価 どう？" });
  await runDurableObjectAlarm(userAgent());

  expect(modelRequests.map(placeOf)).toEqual([
    expect.stringMatching(/Thread: group "チーム"\. Model: test-model\.$/),
  ]);
});

test("a run carried on the next day is told the same day it started, so its prompt doesn't change", async () => {
  const [first] = await userAgent().listAgents();
  const agentId = first?.id ?? "";
  const startedAt = new Date("2026-11-13T23:59:00Z");
  await runInDurableObject(userAgent(), (_, state) => {
    store.insertTask(state.storage, {
      id: "task-1",
      agentId,
      threadId: agentThread(state.storage, agentId),
      prompt: "Summarize today's email",
      schedule: { cron: "59 23 * * *", timeZone: "UTC" },
      nextRunAt: startedAt,
    });
  });
  scriptedModel.push(new Error("The model service is unreachable."), reply("3 new emails."));

  await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => startedAt),
  );
  const retryAt = new Date(startedAt.getTime() + RETRY_DELAY_MS);
  await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => retryAt),
  );

  expect(retryAt.toISOString().startsWith("2026-11-14")).toBe(true);
  expect(modelRequests.map(placeOf)).toEqual([
    expect.stringMatching(/^This run started on 2026-11-13 \(UTC\);/),
    expect.stringMatching(/^This run started on 2026-11-13 \(UTC\);/),
  ]);
  expect(modelRequests[1]?.system).toBe(modelRequests[0]?.system);
});
