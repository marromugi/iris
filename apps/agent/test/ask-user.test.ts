import type { AssistantMessage } from "@iris/agent";
import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import { agentApi, type UserProps } from "../src/api/api";
import { openDatabase } from "../src/users/database";
import { users } from "../src/users/schema";
import { modelRequests, scriptedModel } from "./worker";

afterEach(async () => {
  scriptedModel.length = 0;
  modelRequests.length = 0;
  await reset();
});

function context(props?: UserProps) {
  return { props, waitUntil() {}, passThroughOnException() {} };
}

function call(userId: string, path: string, init?: RequestInit) {
  return agentApi.request(path, init, env, context({ userId }));
}

function post(userId: string, path: string, body: unknown) {
  return call(userId, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function addUser(): Promise<string> {
  const id = crypto.randomUUID();
  await openDatabase(env.DB).insert(users).values({ id, name: "一郎", createdAt: new Date() });
  return id;
}

async function firstAgentId(userId: string): Promise<string> {
  const [first]: { id: string }[] = await (await call(userId, "/api/agents")).json();
  if (first === undefined) {
    throw new Error("The user has no agent.");
  }
  return first.id;
}

const askUser: AssistantMessage = {
  role: "assistant",
  parts: [
    {
      type: "tool-call",
      id: "call-1",
      name: "ask_user",
      input: {
        question: "どちらの日に予約しますか？",
        choices: [{ label: "土曜", description: "午前の枠" }, { label: "日曜" }],
      },
    },
  ],
};

const reply = (text: string): AssistantMessage => ({
  role: "assistant",
  parts: [{ type: "text", text }],
});

test("an agent asks the user, waits with no wake-up set, and carries on with the answer", async () => {
  const userId = await addUser();
  const agentId = await firstAgentId(userId);
  const userAgent = env.USER_AGENT.getByName(userId);
  scriptedModel.push(askUser, reply("日曜で予約しました。"));

  const sent: { id: string } = await (
    await post(userId, `/api/agents/${agentId}/messages`, { text: "予約して" })
  ).json();
  await runDurableObjectAlarm(userAgent);

  const [waiting]: unknown[] = await (await call(userId, `/api/agents/${agentId}/runs`)).json();
  expect(waiting).toMatchObject({
    id: sent.id,
    endedAt: null,
    question: {
      question: "どちらの日に予約しますか？",
      choices: [{ label: "土曜", description: "午前の枠" }, { label: "日曜" }],
      multiSelect: false,
    },
  });
  expect(modelRequests).toHaveLength(1);
  expect(modelRequests[0]?.tools.map((tool) => tool.name)).toContain("ask_user");
  expect(await runInDurableObject(userAgent, (_, state) => state.storage.getAlarm())).toBeNull();

  const answered = await post(userId, `/api/runs/${sent.id}/answer`, { answer: "日曜" });
  expect(answered.status).toBe(202);
  expect(await answered.json()).toMatchObject({ id: sent.id, endedAt: null, question: null });
  await runDurableObjectAlarm(userAgent);

  expect(modelRequests[1]?.messages.at(-1)).toEqual({
    role: "tool",
    callId: "call-1",
    isError: false,
    content: "日曜",
  });
  const [ended]: { endedAt: string | null; messages: unknown[] }[] = await (
    await call(userId, `/api/agents/${agentId}/runs`)
  ).json();
  expect(ended?.endedAt).not.toBeNull();
  expect(ended?.messages.at(-1)).toEqual(reply("日曜で予約しました。"));
});

test("says why an answer isn't taken", async () => {
  const userId = await addUser();
  const agentId = await firstAgentId(userId);
  scriptedModel.push(reply("こんにちは"));
  const sent: { id: string } = await (
    await post(userId, `/api/agents/${agentId}/messages`, { text: "やあ" })
  ).json();

  const notAsked = await post(userId, `/api/runs/${sent.id}/answer`, { answer: "はい" });
  const empty = await post(userId, `/api/runs/${sent.id}/answer`, { answer: " " });
  const missing = await post(userId, `/api/runs/${crypto.randomUUID()}/answer`, { answer: "はい" });
  const otherUser = await post(await addUser(), `/api/runs/${sent.id}/answer`, { answer: "はい" });

  expect(notAsked.status).toBe(409);
  expect(empty.status).toBe(400);
  expect(missing.status).toBe(404);
  expect(otherUser.status).toBe(404);
});

test("a run in a group isn't offered ask_user", async () => {
  const userId = await addUser();
  const first = await firstAgentId(userId);
  const second: { id: string } = await (await post(userId, "/api/agents", { name: "株価" })).json();
  const group: { id: string } = await (
    await post(userId, "/api/threads", { name: "チーム", agentIds: [first, second.id] })
  ).json();
  scriptedModel.push(reply("はい"));

  await post(userId, `/api/threads/${group.id}/posts`, { text: "@株価 今日は？" });
  await runDurableObjectAlarm(env.USER_AGENT.getByName(userId));

  expect(modelRequests[0]?.tools.map((tool) => tool.name)).not.toContain("ask_user");
});
