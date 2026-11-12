import type { AssistantMessage, ModelRequest } from "@iris/agent";
import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import { runDue, type RunWatcher } from "../src/runner";
import * as store from "../src/store";
import { NO_ACTIVE_REPLIER } from "../src/user-agent";
import { listen } from "./run-events";
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

const ask = (agent: string, question: string): AssistantMessage => ({
  role: "assistant",
  parts: [{ type: "tool-call", id: "call-1", name: "ask_agent", input: { agent, question } }],
});

/** Sends a message to the agent straight in storage, so no alarm of the object's own carries it on; returns its run's ID. */
async function messageInStorage(agentId: string, text: string): Promise<string> {
  return runInDurableObject(userAgent(), (_, state) => {
    const [runId = ""] = store.insertPost(
      state.storage,
      {
        id: crypto.randomUUID(),
        threadId: store.agentThreadId(state.storage, agentId) ?? "",
        agentId: null,
        callId: null,
        text,
        createdAt: new Date(),
      },
      [agentId],
    );
    return runId;
  });
}

async function addAgent(name: string): Promise<string> {
  const added = await userAgent().addAgent({ name });
  if (!added.ok) {
    throw new Error(added.error);
  }
  return added.agent.id;
}

/** Two agents and a group of both; returns their IDs and the group's. */
async function pair() {
  const mail = await addAgent("メール");
  const stocks = await addAgent("株価");
  const group = await userAgent().addGroup({ name: "チーム", agentIds: [mail, stocks] });
  if (!group.ok) {
    throw new Error(group.error);
  }
  return { mail, stocks, groupId: group.thread.id };
}

test("a deactivated agent lists as inactive, its due task doesn't run, and activating moves the task past now", async () => {
  const agentId = await addAgent("メール");
  const dueAt = new Date(Date.now() - 60_000);
  await runInDurableObject(userAgent(), (_, state) => {
    store.insertTask(state.storage, {
      id: "task-1",
      agentId,
      threadId: store.agentThreadId(state.storage, agentId) ?? "",
      prompt: "Summarize today's email",
      schedule: { cron: "0 8 * * *", timeZone: "UTC" },
      nextRunAt: dueAt,
    });
  });

  expect(await userAgent().deactivateAgent(agentId)).toBe(true);
  expect(await runInDurableObject(userAgent(), (_, state) => state.storage.getAlarm())).toBeNull();
  const ran = await runInDurableObject(userAgent(), async (_, state) => {
    await runDue(state.storage, testAgent, () => new Date());
    return {
      alarm: await state.storage.getAlarm(),
      runs: store.recentRuns(state.storage, store.agentThreadId(state.storage, agentId) ?? "", 10),
    };
  });
  expect(ran).toEqual({ alarm: null, runs: [] });
  expect((await userAgent().listAgents()).find((agent) => agent.id === agentId)?.active).toBe(
    false,
  );

  const before = Date.now();
  expect(await userAgent().activateAgent(agentId)).toBe(true);
  const [task] = (await userAgent().listTasks(agentId)) ?? [];
  expect(task?.nextRunAt.getTime()).toBeGreaterThan(before);
  expect((await userAgent().listAgents()).find((agent) => agent.id === agentId)?.active).toBe(true);
  expect(await runInDurableObject(userAgent(), (_, state) => state.storage.getAlarm())).toBe(
    task?.nextRunAt.getTime(),
  );
});

test("deactivating ends the agent's runs that haven't ended, so the group's later runs don't wait on them", async () => {
  const { mail, stocks, groupId } = await pair();
  const first = await userAgent().post(groupId, { text: "おはよう" });
  if (first?.ok !== true) {
    throw new Error("The post was refused.");
  }
  const stocksRun = first.runs.find((run) => run.agentId === stocks)?.id ?? "";

  await userAgent().deactivateAgent(stocks);
  const second = await userAgent().post(groupId, { text: "次の話" });

  expect(second?.ok && second.runs.map((run) => run.agentId)).toEqual([mail]);
  const ended = await runInDurableObject(userAgent(), (_, state) =>
    store.findRun(state.storage, stocksRun),
  );
  expect([ended?.endedAt instanceof Date, ended?.lastError]).toEqual([
    true,
    store.DEACTIVATED_ERROR,
  ]);
  scriptedModel.push(reply("おはようございます。"), reply("次ですね。"));
  await runInDurableObject(userAgent(), async (_, state) => {
    await runDue(state.storage, testAgent, () => new Date(Date.now() + 1000));
  });
  const entries = (await userAgent().threadEntries(groupId, 10)) ?? [];
  expect(
    entries.flatMap((entry) =>
      entry.type === "run" && entry.run.agentId === mail ? [entry.run.endedAt !== null] : [],
    ),
  ).toEqual([true, true]);
});

test("a post only a deactivated agent would reply to is refused, and others go without its reply", async () => {
  const { mail, stocks, groupId } = await pair();
  await userAgent().deactivateAgent(stocks);

  const named = await userAgent().post(groupId, { text: "@株価 どう？" });
  const mixed = await userAgent().post(groupId, { text: "@メール @株価 どう？" });
  const everyone = await userAgent().post(groupId, { text: "どう？" });
  const direct = await userAgent().sendMessage(stocks, { text: "どう？" });
  const ownThread = await userAgent().post(
    (await userAgent().listThreads()).find((thread) => thread.agentId === stocks)?.id ?? "",
    { text: "どう？" },
  );
  await userAgent().deactivateAgent(mail);
  const nobody = await userAgent().post(groupId, { text: "どう？" });

  expect(named).toEqual({ ok: false, error: NO_ACTIVE_REPLIER });
  expect(mixed?.ok && mixed.runs.map((run) => run.agentId)).toEqual([mail]);
  expect(everyone?.ok && everyone.runs.map((run) => run.agentId)).toEqual([mail]);
  expect(direct).toEqual({ ok: false, error: NO_ACTIVE_REPLIER });
  expect(ownThread).toEqual({ ok: false, error: NO_ACTIVE_REPLIER });
  expect(nobody).toEqual({ ok: false, error: NO_ACTIVE_REPLIER });
});

test("a run being carried on when its agent is deactivated stops and keeps none of what came after", async () => {
  const agentId = await addAgent("メール");
  const sent = await userAgent().sendMessage(agentId, { text: "まとめて" });
  const runId = sent?.ok ? sent.run.id : "";

  const run = await runInDurableObject(userAgent(), async (_, state) => {
    scriptedModel.push(() => {
      store.deactivateAgent(state.storage, agentId, new Date());
      return reply("遅れた返事");
    });
    await runDue(state.storage, testAgent, () => new Date(Date.now() + 1000));
    return store.findRun(state.storage, runId);
  });

  expect(run?.messages).toEqual([{ role: "user", text: "まとめて" }]);
  expect(run?.lastError).toBe(store.DEACTIVATED_ERROR);
});

test("a deactivated agent isn't offered as one to ask", async () => {
  const { mail, stocks } = await pair();
  await userAgent().deactivateAgent(stocks);
  scriptedModel.push(reply("はい。"));

  await userAgent().sendMessage(mail, { text: "Hi" });
  await runInDurableObject(userAgent(), (_, state) =>
    runDue(state.storage, testAgent, () => new Date(Date.now() + 1000)),
  );

  const [first] = (await userAgent().listAgents()).filter(
    (agent) => agent.id !== mail && agent.id !== stocks,
  );
  const description = modelRequests[0]?.tools[0]?.description ?? "";
  expect(description).toContain(first?.name ?? "");
  expect(description).not.toContain("株価");
});

test("deactivating or activating an agent the user doesn't have says so, and doing it twice changes nothing", async () => {
  const agentId = await addAgent("メール");

  expect(await userAgent().deactivateAgent(crypto.randomUUID())).toBe(false);
  expect(await userAgent().activateAgent(crypto.randomUUID())).toBe(false);
  expect(await userAgent().deactivateAgent(agentId)).toBe(true);
  expect(await userAgent().deactivateAgent(agentId)).toBe(true);
  expect(await userAgent().activateAgent(agentId)).toBe(true);
  expect(await userAgent().activateAgent(agentId)).toBe(true);
  expect((await userAgent().listAgents()).map((agent) => agent.active)).toEqual([true, true]);
});

test("an agent deactivated after a run picked its tools isn't asked by that run", async () => {
  const { mail, stocks } = await pair();
  const runId = await messageInStorage(mail, "株価を聞いてきて");

  const toolResult = await runInDurableObject(userAgent(), async (_, state) => {
    scriptedModel.push(() => {
      store.deactivateAgent(state.storage, stocks, new Date());
      return ask("株価", "今日の株価は？");
    }, reply("聞けませんでした。"));
    await runDue(state.storage, testAgent, () => new Date(Date.now() + 1000));
    return store.findRun(state.storage, runId)?.messages[2];
  });

  expect(toolResult).toEqual({
    role: "tool",
    callId: "call-1",
    isError: true,
    content: 'No agent is named "株価". You can ask: エージェント.',
  });
  expect(modelRequests).toHaveLength(2);
  expect(await userAgent().recentRuns(stocks)).toEqual([]);
});

test("deactivating an agent waiting on an answer ends the answering run too", async () => {
  const { mail, stocks } = await pair();
  const askingRun = await messageInStorage(mail, "株価を聞いてきて");

  const runs = await runInDurableObject(userAgent(), async (_, state) => {
    scriptedModel.push(ask("株価", "今日の株価は？"), () => {
      store.deactivateAgent(state.storage, mail, new Date());
      return reply("上がっています。");
    });
    await runDue(state.storage, testAgent, () => new Date(Date.now() + 1000));
    const answering = state.storage.sql
      .exec<{ id: string }>("SELECT id FROM runs WHERE agent_id = ?", stocks)
      .one().id;
    return [store.findRun(state.storage, askingRun), store.findRun(state.storage, answering)];
  });

  expect(runs.map((run) => [run?.lastError, run?.messages.length])).toEqual([
    [store.DEACTIVATED_ERROR, 2],
    [store.ASKER_DEACTIVATED_ERROR, 1],
  ]);
  expect(modelRequests).toHaveLength(2);
});

test("a run ended by deactivating its agent tells the watcher no more progress, and that it stopped", async () => {
  const agentId = await addAgent("メール");
  const runId = await messageInStorage(agentId, "まとめて");
  const heard: string[] = [];
  const watcher: RunWatcher = {
    changed: () => heard.push("changed"),
    progress: (_, progress) => heard.push(progress.type),
    stopped: () => heard.push("stopped"),
    posted: () => {},
  };

  await runInDurableObject(userAgent(), async (_, state) => {
    scriptedModel.push((request) => {
      request.onProgress?.({ type: "thinking" });
      store.deactivateAgent(state.storage, agentId, new Date());
      request.onProgress?.({ type: "writing", text: "遅れた" });
      return reply("遅れた返事");
    });
    await runDue(state.storage, testAgent, () => new Date(Date.now() + 1000), watcher);
  });

  expect(heard).toEqual(["starting", "thinking", "stopped"]);
  expect(runId).not.toBe("");
});

test("activating an agent that is already active leaves its tasks' times alone", async () => {
  const agentId = await addAgent("メール");
  const added = await userAgent().addTask(agentId, {
    prompt: "まとめて",
    schedule: { cron: "0 8 * * *", timeZone: "UTC" },
  });
  const before = added?.ok ? added.task.nextRunAt : undefined;
  // A time the task would be moved off if activating recomputed it.
  const past = new Date("2026-01-01T08:00:00Z");

  await runInDurableObject(userAgent(), (_, state) => {
    state.storage.sql.exec("UPDATE tasks SET next_run_at = ?", past.getTime());
  });
  await userAgent().activateAgent(agentId);

  const [task] = (await userAgent().listTasks(agentId)) ?? [];
  expect(before).toBeInstanceOf(Date);
  expect(task?.nextRunAt).toEqual(past);
});

test("an open thread hears that deactivating ended its run", async () => {
  const agentId = await addAgent("メール");
  const runId = await messageInStorage(agentId, "まとめて");
  const response = await userAgent().fetch(`https://iris.test/?agentId=${agentId}`, {
    headers: { Upgrade: "websocket" },
  });
  const socket = listen(response.webSocket);

  await userAgent().deactivateAgent(agentId);

  const [event] = await socket.heard(1);
  expect(event).toMatchObject({
    type: "run",
    run: { id: runId, lastError: store.DEACTIVATED_ERROR },
  });
});

test("a run whose agent is deactivated just after its last message, or as its step fails, keeps the deactivation", async () => {
  const saved = await addAgent("メール");
  const failing = await addAgent("株価");
  const savedRun = await messageInStorage(saved, "まとめて");
  const failingRun = await messageInStorage(failing, "調べて");

  const runs = await runInDurableObject(userAgent(), async (_, state) => {
    let deactivatedSaved = false;
    const watcher: RunWatcher = {
      changed: (runId) => {
        if (
          runId === savedRun &&
          !deactivatedSaved &&
          store.findRun(state.storage, runId)?.messages.length === 2
        ) {
          deactivatedSaved = true;
          store.deactivateAgent(state.storage, saved, new Date());
        }
      },
      progress: () => {},
      stopped: () => {},
      posted: () => {},
    };
    // The two runs ask the model side by side; the failing one is deactivated as its step fails.
    const step = (request: ModelRequest) => {
      if (JSON.stringify(request.messages).includes("調べて")) {
        store.deactivateAgent(state.storage, failing, new Date());
        throw new Error("The model service is unreachable.");
      }
      return reply("まとめました。");
    };
    scriptedModel.push(step, step);
    await runDue(state.storage, testAgent, () => new Date(Date.now() + 1000), watcher);
    return [store.findRun(state.storage, savedRun), store.findRun(state.storage, failingRun)];
  });

  expect(runs.map((run) => [run?.lastError, run?.failedAttempts])).toEqual([
    [store.DEACTIVATED_ERROR, 0],
    [store.DEACTIVATED_ERROR, 0],
  ]);
});
