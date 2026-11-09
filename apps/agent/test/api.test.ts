import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import apiDocument from "../openapi.json";
import { agentApi, agentApiDocument, PRODUCTION_ORIGIN, type UserProps } from "../src/api/api";
import * as store from "../src/store";
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

function addTask(userId: string, body: unknown) {
  return call(userId, "/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const dailyMail = {
  prompt: "Summarize today's email",
  schedule: { cron: "0 8 * * *", timeZone: "Asia/Tokyo" },
};

test("adds a task and lists it for that user only", async () => {
  const added = await addTask("user-1", dailyMail);

  expect(added.status).toBe(201);
  const task = await added.json();
  expect(task).toEqual({
    id: expect.any(String),
    ...dailyMail,
    nextRunAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T23:00:00\.000Z$/),
  });
  expect(await (await call("user-1", "/api/tasks")).json()).toEqual([task]);
  expect(await (await call("user-2", "/api/tasks")).json()).toEqual([]);
});

test("says why a task can't be added", async () => {
  const added = await addTask("user-1", {
    ...dailyMail,
    schedule: { cron: "0 8 * * *", timeZone: "Mars/Olympus" },
  });

  expect(added.status).toBe(400);
  expect(await added.json()).toEqual({
    message: "✖ Not a known IANA time zone.\n  → at schedule.timeZone",
  });
});

test("removes a task, and answers 404 for one that isn't there", async () => {
  const task: { id: string } = await (await addTask("user-1", dailyMail)).json();

  expect((await call("user-1", `/api/tasks/${task.id}`, { method: "DELETE" })).status).toBe(204);
  const again = await call("user-1", `/api/tasks/${task.id}`, { method: "DELETE" });
  expect(again.status).toBe(404);
  expect(await again.json()).toEqual({ message: "No task of this user has this ID" });
});

test("lists the latest runs with their conversations", async () => {
  const agent = env.USER_AGENT.getByName("user-1");
  const dueAt = new Date(Date.now() - 60_000);
  await runInDurableObject(agent, async (_, state) => {
    store.insertTask(state.storage, {
      id: "8f2a6c1e-3b4d-4e5f-9a0b-1c2d3e4f5a6b",
      prompt: "Summarize today's email",
      schedule: { cron: "0 8 * * *", timeZone: "UTC" },
      nextRunAt: dueAt,
    });
    await state.storage.setAlarm(dueAt);
  });
  scriptedModel.push({ role: "assistant", parts: [{ type: "text", text: "3 new emails." }] });
  await runDurableObjectAlarm(agent);

  const runs = await call("user-1", "/api/runs?limit=5");

  expect(runs.status).toBe(200);
  expect(await runs.json()).toEqual([
    {
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
    },
  ]);
});

test("refuses a request that reaches it without a signed-in user", async () => {
  const response = await agentApi.request("/api/tasks", undefined, env, context());

  expect(response.status).toBe(403);
});

test("openapi.json is the document the routes make", () => {
  expect(apiDocument).toEqual(JSON.parse(JSON.stringify(agentApiDocument(PRODUCTION_ORIGIN))));
});
