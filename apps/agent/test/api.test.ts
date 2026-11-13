import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";
import apiDocument from "../openapi.json";
import { agentApi, agentApiDocument, type UserProps } from "../src/api/api";
import * as store from "../src/store";
import { openDatabase } from "../src/users/database";
import { users } from "../src/users/schema";
import { listen } from "./run-events";
import { scriptedModel } from "./worker";
import { agentThread } from "./agent-thread";

/** Any look; agents get one at random unless they are given one. */
const anyLook = { palette: expect.any(Number), seed: expect.any(Number) };

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
  expect(await response.json()).toEqual({ id: userId, name: "花子", canAttachImages: true });
});

test("lists the agent a user starts with", async () => {
  const response = await call(await addUser("一郎"), "/api/agents");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([
    { id: expect.any(String), name: "エージェント", look: anyLook, lastRanAt: null, active: true },
  ]);
});

test("adds an agent, which then lists last, and says why one can't be added", async () => {
  const userId = await addUser("一郎");

  const added = await post(userId, "/api/agents", { name: "株価の確認" });
  const blank = await post(userId, "/api/agents", { name: " " });

  expect(added.status).toBe(201);
  const agent = await added.json();
  expect(agent).toEqual({
    id: expect.any(String),
    name: "株価の確認",
    look: anyLook,
    lastRanAt: null,
    active: true,
  });
  const listed: { name: string }[] = await (await call(userId, "/api/agents")).json();
  expect(listed.map((each) => each.name)).toEqual(["エージェント", "株価の確認"]);
  expect(blank.status).toBe(400);
  expect(await blank.json()).toEqual({ message: expect.any(String) });
});

test("adds a task to one agent and lists it for that agent only", async () => {
  const [user1, user2] = [await addUser("一郎"), await addUser("二郎")];
  const agentId = await firstAgentId(user1);
  const other = crypto.randomUUID();
  await runInDurableObject(env.USER_AGENT.getByName(user1), (_, state) => {
    store.insertAgent(state.storage, {
      id: other,
      name: "株価の確認",
      look: { palette: 0, seed: 0 },
      createdAt: new Date(),
    });
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

test("deactivates an agent, which lists as inactive and takes no message, and activates it again", async () => {
  const userId = await addUser("一郎");
  const agentId = await firstAgentId(userId);
  const active = async () => {
    const listed: { active: boolean }[] = await (await call(userId, "/api/agents")).json();
    return listed[0]?.active;
  };

  const deactivated = await call(userId, `/api/agents/${agentId}/deactivate`, { method: "POST" });
  const listedInactive = await active();
  const refused = await post(userId, `/api/agents/${agentId}/messages`, { text: "Hello" });
  const activated = await call(userId, `/api/agents/${agentId}/activate`, { method: "POST" });

  expect([deactivated.status, listedInactive, refused.status]).toEqual([204, false, 400]);
  expect(await refused.json()).toEqual({ message: expect.any(String) });
  expect([activated.status, await active()]).toEqual([204, true]);
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
    await call(userId, `/api/agents/${missing}/deactivate`, { method: "POST" }),
    await call(userId, `/api/agents/${missing}/activate`, { method: "POST" }),
    await post(userId, `/api/agents/${missing}/messages`, { text: "Hello" }),
    await call(userId, `/api/agents/${missing}/events`, { headers: { Upgrade: "websocket" } }),
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

test("lists an agent's latest runs with their conversations, without the model's reasoning, and when it last ran", async () => {
  const userId = await addUser("一郎");
  const agentId = await firstAgentId(userId);
  const agents = env.USER_AGENT.getByName(userId);
  const dueAt = new Date(Date.now() - 60_000);
  await runInDurableObject(agents, async (_, state) => {
    store.insertTask(state.storage, {
      id: "8f2a6c1e-3b4d-4e5f-9a0b-1c2d3e4f5a6b",
      agentId,
      threadId: agentThread(state.storage, agentId),
      prompt: "Summarize today's email",
      schedule: { cron: "0 8 * * *", timeZone: "UTC" },
      nextRunAt: dueAt,
    });
    await state.storage.setAlarm(dueAt);
  });
  scriptedModel.push({
    role: "assistant",
    parts: [
      { type: "reasoning", data: { type: "thinking", thinking: "", signature: "s1" } },
      { type: "text", text: "3 new emails." },
    ],
  });
  await runDurableObjectAlarm(agents);

  const runs = await call(userId, `/api/agents/${agentId}/runs?limit=5`);

  expect(runs.status).toBe(200);
  const [run]: { startedAt: string }[] = await runs.json();
  expect(run).toEqual({
    id: expect.any(String),
    agentId,
    taskId: "8f2a6c1e-3b4d-4e5f-9a0b-1c2d3e4f5a6b",
    postId: null,
    startedAt: expect.any(String),
    endedAt: expect.any(String),
    lastError: null,
    failedAttempts: 0,
    consults: [],
    messages: [
      { role: "user", text: "Summarize today's email" },
      { role: "assistant", parts: [{ type: "text", text: "3 new emails." }] },
    ],
  });
  expect(await (await call(userId, "/api/agents")).json()).toEqual([
    { id: agentId, name: "エージェント", look: anyLook, lastRanAt: run?.startedAt, active: true },
  ]);
});

test("sends a message to an agent, which starts one of its runs, and says why one can't be sent", async () => {
  const userId = await addUser("一郎");
  const agentId = await firstAgentId(userId);

  const sent = await post(userId, `/api/agents/${agentId}/messages`, { text: "Hello" });
  const empty = await post(userId, `/api/agents/${agentId}/messages`, { text: " " });

  expect(sent.status).toBe(202);
  const run = await sent.json();
  expect(run).toEqual({
    id: expect.any(String),
    agentId,
    taskId: null,
    postId: expect.any(String),
    startedAt: expect.any(String),
    endedAt: null,
    lastError: null,
    failedAttempts: 0,
    consults: [],
    messages: [{ role: "user", text: "Hello" }],
  });
  expect(await (await call(userId, `/api/agents/${agentId}/runs`)).json()).toEqual([run]);
  expect(empty.status).toBe(400);
});

test("an agent's event socket hears a sent message's run start, get on, and end", async () => {
  const userId = await addUser("一郎");
  const agentId = await firstAgentId(userId);
  const opened = await call(userId, `/api/agents/${agentId}/events`, {
    headers: { Upgrade: "websocket" },
  });
  expect(opened.status).toBe(101);
  const socket = listen(opened.webSocket);
  scriptedModel.push((request) => {
    request.onProgress?.({ type: "thinking" });
    request.onProgress?.({ type: "writing", text: "Hel" });
    // Within the same 100 ms, so it doesn't go out; the run event after it has the whole reply.
    request.onProgress?.({ type: "writing", text: "Hello" });
    return { role: "assistant", parts: [{ type: "text", text: "Hello." }] };
  });

  const sent: { id: string } = await (
    await post(userId, `/api/agents/${agentId}/messages`, { text: "Hi" })
  ).json();
  await runDurableObjectAlarm(env.USER_AGENT.getByName(userId));
  const events = await socket.heard(6);

  expect(
    events.map((event) => (event.type === "progress" ? event.progress.type : event.type)),
  ).toEqual(["run", "starting", "thinking", "writing", "run", "run"]);
  expect(events[3]).toEqual({
    type: "progress",
    runId: sent.id,
    progress: { type: "writing", text: "Hel" },
  });
  const last = events.at(-1);
  expect(last?.type === "run" && last.run).toMatchObject({
    id: sent.id,
    endedAt: expect.any(String),
    messages: [
      { role: "user", text: "Hi" },
      { role: "assistant", parts: [{ type: "text", text: "Hello." }] },
    ],
  });
  const plain = await call(userId, `/api/agents/${agentId}/events`);
  expect([plain.status, await plain.json()]).toEqual([
    426,
    { message: "Open this as a WebSocket" },
  ]);
});

test("makes a group, lists it with the one-to-one threads, and posts in it", async () => {
  const userId = await addUser("一郎");
  const first = await firstAgentId(userId);
  const second: { id: string } = await (await post(userId, "/api/agents", { name: "株価" })).json();

  const made = await post(userId, "/api/threads", { name: "チーム", agentIds: [first, second.id] });
  const tooFew = await post(userId, "/api/threads", { name: "一人", agentIds: [first] });
  const group: { id: string } = await made.json();
  const sent = await post(userId, `/api/threads/${group.id}/posts`, { text: "@株価 今日は？" });
  const listed: { name: string }[] = await (await call(userId, "/api/threads")).json();
  const entries: { type: string }[] = await (
    await call(userId, `/api/threads/${group.id}/entries?limit=5`)
  ).json();
  const missing = await call(userId, `/api/threads/${crypto.randomUUID()}/entries`);

  expect(made.status).toBe(201);
  expect(group).toEqual({
    id: expect.any(String),
    name: "チーム",
    agentId: null,
    consultRunId: null,
    agentIds: [first, second.id],
    lastActivityAt: expect.any(String),
  });
  expect(tooFew.status).toBe(400);
  expect(sent.status).toBe(202);
  expect(await sent.json()).toEqual({
    post: {
      id: expect.any(String),
      agentId: null,
      text: "@株価 今日は？",
      attachments: [],
      createdAt: expect.any(String),
    },
    runs: [expect.objectContaining({ agentId: second.id, taskId: null, endedAt: null })],
  });
  expect(listed.map((thread) => thread.name)).toEqual(["チーム", "株価", "エージェント"]);
  expect(entries.map((entry) => entry.type)).toEqual(["run", "post"]);
  expect(missing.status).toBe(404);
});

test("a thread's event socket hears a post, then the runs that reply to it", async () => {
  const userId = await addUser("一郎");
  const first = await firstAgentId(userId);
  const [thread]: { id: string }[] = await (await call(userId, "/api/threads")).json();
  const opened = await call(userId, `/api/threads/${thread?.id}/events`, {
    headers: { Upgrade: "websocket" },
  });
  const socket = listen(opened.webSocket);

  scriptedModel.push({ role: "assistant", parts: [{ type: "text", text: "Hello." }] });
  await post(userId, `/api/threads/${thread?.id}/posts`, { text: "Hi" });
  const events = await socket.heard(2);

  expect(opened.status).toBe(101);
  expect(events.slice(0, 2).map((event) => event.type)).toEqual(["post", "run"]);
  expect(events[1]).toMatchObject({ type: "run", run: { agentId: first } });
});

test("sets the user's time zone, and says why one can't be set", async () => {
  const userId = await addUser("花子");
  const put = (body: unknown) =>
    call(userId, "/api/me/time-zone", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const set = await put({ timeZone: "Europe/London" });
  const unknown = await put({ timeZone: "Mars/Olympus" });

  expect(set.status).toBe(204);
  expect(unknown.status).toBe(400);
  expect(await unknown.json()).toEqual({ message: expect.stringContaining("time zone") });
  expect(
    await runInDurableObject(env.USER_AGENT.getByName(userId), (_, state) =>
      store.userTimeZone(state.storage),
    ),
  ).toBe("Europe/London");
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

/** The smallest bytes that start like a JPEG, which is all the API checks. */
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function putUp(userId: string, body: Uint8Array, contentType = "image/jpeg", testEnv: Env = env) {
  return agentApi.request(
    "/api/attachments",
    { method: "POST", headers: { "Content-Type": contentType }, body },
    testEnv,
    context({ userId }),
  );
}

async function agentThreadId(userId: string): Promise<string> {
  const threads: { id: string; agentId: string | null }[] = await (
    await call(userId, "/api/threads")
  ).json();
  const thread = threads.find((each) => each.agentId !== null);
  if (thread === undefined) {
    throw new Error("The user has no one-to-one thread.");
  }
  return thread.id;
}

test("puts up an image, sends it with a post, and gives its bytes back", async () => {
  const userId = await addUser("花子");
  const threadId = await agentThreadId(userId);
  scriptedModel.push({ role: "assistant", parts: [{ type: "text", text: "いい写真ですね。" }] });

  const putResponse = await putUp(userId, jpeg);
  const attachment: { id: string } = await putResponse.clone().json();
  const sent = await post(userId, `/api/threads/${threadId}/posts`, {
    text: "",
    attachmentIds: [attachment.id],
  });
  const again = await post(userId, `/api/threads/${threadId}/posts`, {
    text: "もう一度",
    attachmentIds: [attachment.id],
  });
  const bytes = await call(userId, `/api/attachments/${attachment.id}`);
  const entries: { type: string; post?: unknown }[] = await (
    await call(userId, `/api/threads/${threadId}/entries`)
  ).json();

  const kept = { id: expect.any(String), mediaType: "image/jpeg", size: jpeg.byteLength };
  expect(putResponse.status).toBe(201);
  expect(await putResponse.json()).toEqual(kept);
  expect(sent.status).toBe(202);
  const sentJson: { post: unknown; runs: { messages: unknown[] }[] } = await sent.json();
  expect(sentJson.post).toMatchObject({ text: "", attachments: [kept] });
  // The run's first message leaves its images to the post.
  expect(sentJson.runs.map((run) => run.messages)).toEqual([[{ role: "user", text: "" }]]);
  expect(again.status).toBe(400);
  expect(await again.json()).toEqual({ message: "An image isn't there, or was already sent." });
  expect(bytes.status).toBe(200);
  expect(bytes.headers.get("Content-Type")).toBe("image/jpeg");
  expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(jpeg);
  expect(entries.filter((entry) => entry.type === "post")).toEqual([
    { type: "post", post: expect.objectContaining({ attachments: [kept] }) },
  ]);
});

test("keeps the images of a post in the order they were sent", async () => {
  const userId = await addUser("花子");
  scriptedModel.push({ role: "assistant", parts: [{ type: "text", text: "はい。" }] });
  const ids: string[] = [];
  for (const body of [jpeg, new Uint8Array([...jpeg, 9])]) {
    const { id }: { id: string } = await (await putUp(userId, body)).json();
    ids.push(id);
  }

  const sent = await post(userId, `/api/agents/${await firstAgentId(userId)}/messages`, {
    text: "二枚",
    attachmentIds: ids.toReversed(),
  });
  const entries: { type: string; post?: { attachments: { id: string }[] } }[] = await (
    await call(userId, `/api/threads/${await agentThreadId(userId)}/entries`)
  ).json();

  expect(sent.status).toBe(202);
  expect(
    entries.find((entry) => entry.type === "post")?.post?.attachments.map((a) => a.id),
  ).toEqual(ids.toReversed());
});

test("says why an image or a post with one isn't taken", async () => {
  const userId = await addUser("花子");
  const threadId = await agentThreadId(userId);

  const wrongType = await putUp(userId, jpeg, "application/pdf");
  const notJpeg = await putUp(userId, new Uint8Array([1, 2, 3]));
  const tooLarge = await putUp(userId, new Uint8Array(5 * 1024 * 1024 + 1).fill(0xff));
  const unknown = await post(userId, `/api/threads/${threadId}/posts`, {
    text: "これ",
    attachmentIds: [crypto.randomUUID()],
  });
  const empty = await post(userId, `/api/threads/${threadId}/posts`, { text: " " });
  const fiveImages = await post(userId, `/api/threads/${threadId}/posts`, {
    text: "多い",
    attachmentIds: Array.from({ length: 5 }, () => crypto.randomUUID()),
  });
  const missing = await call(userId, `/api/attachments/${crypto.randomUUID()}`);

  expect(wrongType.status).toBe(415);
  expect(notJpeg.status).toBe(400);
  expect(await notJpeg.json()).toEqual({ message: "The body isn't an image of type image/jpeg." });
  expect(tooLarge.status).toBe(413);
  expect(unknown.status).toBe(400);
  expect(empty.status).toBe(400);
  expect(fiveImages.status).toBe(400);
  expect(missing.status).toBe(404);
});

test("gives no user another user's image", async () => {
  const owner = await addUser("花子");
  const other = await addUser("一郎");
  const { id }: { id: string } = await (await putUp(owner, jpeg)).json();

  const seen = await call(other, `/api/attachments/${id}`);
  const sent = await post(other, `/api/threads/${await agentThreadId(other)}/posts`, {
    text: "これ",
    attachmentIds: [id],
  });

  expect(seen.status).toBe(404);
  expect(sent.status).toBe(400);
});

test("takes no images while the model doesn't read them", async () => {
  const userId = await addUser("花子");
  const { id }: { id: string } = await (await putUp(userId, jpeg)).json();
  // wrangler types gives MODEL_PROVIDER wrangler.jsonc's one value as its type.
  const workersAi: Env = { ...env };
  Reflect.set(workersAi, "MODEL_PROVIDER", "workers-ai");

  const me: { canAttachImages: boolean } = await (
    await agentApi.request("/api/me", undefined, workersAi, context({ userId }))
  ).json();
  const putResponse = await putUp(userId, jpeg, "image/jpeg", workersAi);
  const sent = await agentApi.request(
    `/api/threads/${await agentThreadId(userId)}/posts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "これ", attachmentIds: [id] }),
    },
    workersAi,
    context({ userId }),
  );

  expect(me.canAttachImages).toBe(false);
  expect(putResponse.status).toBe(400);
  expect(sent.status).toBe(400);
  expect(await sent.json()).toEqual({
    message: "The model the agents think with doesn't read images.",
  });
});

test("removes the images no post took within a day when another is put up", async () => {
  const userId = await addUser("花子");
  const { id: stale }: { id: string } = await (await putUp(userId, jpeg)).json();
  await runInDurableObject(env.USER_AGENT.getByName(userId), (_, state) => {
    state.storage.sql.exec(
      "UPDATE attachments SET created_at = ? WHERE id = ?",
      Date.now() - 25 * 60 * 60 * 1000,
      stale,
    );
  });

  const { id: fresh }: { id: string } = await (await putUp(userId, jpeg)).json();

  expect((await call(userId, `/api/attachments/${stale}`)).status).toBe(404);
  expect(await env.ATTACHMENTS.get(`${userId}/${stale}`)).toBeNull();
  expect((await call(userId, `/api/attachments/${fresh}`)).status).toBe(200);
});
