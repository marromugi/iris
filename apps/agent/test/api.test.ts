import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";
import apiDocument from "../openapi.json";
import { agentApi, agentApiDocument, type UserProps } from "../src/api/api";
import * as store from "../src/store";
import { openDatabase } from "../src/users/database";
import { users } from "../src/users/schema";
import { scriptedModel } from "./worker";

afterEach(async () => {
  scriptedModel.length = 0;
  await reset();
});

/** What the OAuth layer hands a request: `props` for a signed-in user, none otherwise. */
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

/** A user as signing in leaves them in D1; returns their ID. */
async function addUser(name: string): Promise<string> {
  const id = crypto.randomUUID();
  await openDatabase(env.DB).insert(users).values({ id, name, createdAt: new Date() });
  return id;
}

/** The ID of the agent every user starts with. */
async function firstAgentId(userId: string): Promise<string> {
  const [first]: { id: string }[] = await (await call(userId, "/api/agents")).json();
  if (first === undefined) {
    throw new Error("The user has no agent.");
  }
  return first.id;
}

const dailyMail = {
  prompt: "Summarize today's email",
  schedule: { cron: "0 8 * * *", timeZone: "Asia/Tokyo" },
};

test("tells the signed-in user who they are", async () => {
  const userId = await addUser("花子");

  const response = await call(userId, "/api/me");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: userId, name: "花子" });
});

test("lists the agent a user starts with", async () => {
  const response = await call(await addUser("一郎"), "/api/agents");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([
    { id: expect.any(String), name: "エージェント", lastRanAt: null },
  ]);
});

test("adds a task to one agent and lists it for that agent only", async () => {
  const [user1, user2] = [await addUser("一郎"), await addUser("二郎")];
  const agentId = await firstAgentId(user1);
  const other = crypto.randomUUID();
  await runInDurableObject(env.USER_AGENT.getByName(user1), (_, state) => {
    store.insertAgent(state.storage, { id: other, name: "株価の確認", createdAt: new Date() });
  });

  const added = await post(user1, `/api/agents/${agentId}/tasks`, dailyMail);

  expect(added.status).toBe(201);
  const task = await added.json();
  expect(task).toEqual({
    id: expect.any(String),
    ...dailyMail,
    nextRunAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T23:00:00Z$/),
  });
  expect(await (await call(user1, `/api/agents/${agentId}/tasks`)).json()).toEqual([task]);
  expect(await (await call(user1, `/api/agents/${other}/tasks`)).json()).toEqual([]);
  expect((await call(user2, `/api/agents/${agentId}/tasks`)).status).toBe(404);
});

test("answers 404 for an agent the user doesn't have, and 400 for an ID that isn't one", async () => {
  const userId = await addUser("一郎");
  const missing = crypto.randomUUID();

  const responses = [
    await call(userId, `/api/agents/${missing}/tasks`),
    await post(userId, `/api/agents/${missing}/tasks`, dailyMail),
    await call(userId, `/api/agents/${missing}/tasks/${crypto.randomUUID()}`, {
      method: "DELETE",
    }),
    await call(userId, `/api/agents/${missing}/runs`),
  ];

  for (const response of responses) {
    expect([response.status, await response.json()]).toEqual([
      404,
      { message: "No agent of this user has this ID" },
    ]);
  }
  expect((await call(userId, "/api/agents/not-an-id/tasks")).status).toBe(400);
});

test("says why a task can't be added", async () => {
  const userId = await addUser("一郎");
  const added = await post(userId, `/api/agents/${await firstAgentId(userId)}/tasks`, {
    ...dailyMail,
    schedule: { cron: "0 8 * * *", timeZone: "Mars/Olympus" },
  });

  expect(added.status).toBe(400);
  expect(await added.json()).toEqual({
    message: "✖ Not a known IANA time zone.\n  → at schedule.timeZone",
  });
});

test("answers a body it can't read as { message }", async () => {
  const userId = await addUser("一郎");
  const path = `/api/agents/${await firstAgentId(userId)}/tasks`;
  const malformed = await call(userId, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{bad",
  });
  const notJson = await call(userId, path, { method: "POST", body: "prompt=hi" });

  expect([malformed.status, await malformed.json()]).toEqual([
    400,
    { message: "Malformed JSON in request body" },
  ]);
  expect([notJson.status, await notJson.json()]).toEqual([
    415,
    { message: "Unsupported Media Type" },
  ]);
});

test("removes a task, and answers 404 for one that isn't there", async () => {
  const userId = await addUser("一郎");
  const tasks = `/api/agents/${await firstAgentId(userId)}/tasks`;
  const task: { id: string } = await (await post(userId, tasks, dailyMail)).json();

  expect((await call(userId, `${tasks}/${task.id}`, { method: "DELETE" })).status).toBe(204);
  const again = await call(userId, `${tasks}/${task.id}`, { method: "DELETE" });
  expect(again.status).toBe(404);
  expect(await again.json()).toEqual({ message: "No task of this agent has this ID" });
});

test("lists an agent's latest runs with their conversations, and when it last ran", async () => {
  const userId = await addUser("一郎");
  const agentId = await firstAgentId(userId);
  const agents = env.USER_AGENT.getByName(userId);
  const dueAt = new Date(Date.now() - 60_000);
  await runInDurableObject(agents, async (_, state) => {
    store.insertTask(state.storage, {
      id: "8f2a6c1e-3b4d-4e5f-9a0b-1c2d3e4f5a6b",
      agentId,
      prompt: "Summarize today's email",
      schedule: { cron: "0 8 * * *", timeZone: "UTC" },
      nextRunAt: dueAt,
    });
    await state.storage.setAlarm(dueAt);
  });
  scriptedModel.push({ role: "assistant", parts: [{ type: "text", text: "3 new emails." }] });
  await runDurableObjectAlarm(agents);

  const runs = await call(userId, `/api/agents/${agentId}/runs?limit=5`);

  expect(runs.status).toBe(200);
  const [run]: { startedAt: string }[] = await runs.json();
  expect(run).toEqual({
    id: expect.any(String),
    taskId: "8f2a6c1e-3b4d-4e5f-9a0b-1c2d3e4f5a6b",
    startedAt: expect.any(String),
    endedAt: expect.any(String),
    lastError: null,
    failedAttempts: 0,
    messages: [
      { role: "user", text: "Summarize today's email" },
      { role: "assistant", parts: [{ type: "text", text: "3 new emails." }] },
    ],
  });
  expect(await (await call(userId, "/api/agents")).json()).toEqual([
    { id: agentId, name: "エージェント", lastRanAt: run?.startedAt },
  ]);
});

test("refuses a request that reaches it without a signed-in user", async () => {
  const response = await agentApi.request("/api/agents", undefined, env, context());

  expect(response.status).toBe(403);
});

test("refuses a user that no longer exists", async () => {
  const userId = await addUser("一郎");
  await openDatabase(env.DB).delete(users).where(eq(users.id, userId));

  const response = await call(userId, "/api/me");

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ message: "Forbidden" });
});

test("openapi.json is the document the routes make, served where the Worker is", () => {
  expect(apiDocument).toEqual(JSON.parse(JSON.stringify(agentApiDocument(env.ORIGIN))));
});
