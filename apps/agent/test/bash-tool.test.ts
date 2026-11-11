import type { AssistantMessage } from "@iris/agent";
import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import { runDue } from "../src/runner";
import { bashTool, shellReport } from "../src/sandbox/bash-tool";
import { lastOutput, MAX_OUTPUT_BYTES, type ShellResult } from "../src/sandbox/shell";
import * as store from "../src/store";
import { modelRequests, scriptedModel, testAgent } from "./worker";

afterEach(async () => {
  scriptedModel.length = 0;
  modelRequests.length = 0;
  await reset();
});

const userAgent = () => env.USER_AGENT.getByName("user-1");

const runBash = (command: string): AssistantMessage => ({
  role: "assistant",
  parts: [{ type: "tool-call", id: "call-1", name: "bash", input: { command } }],
});

const reply = (text: string): AssistantMessage => ({
  role: "assistant",
  parts: [{ type: "text", text }],
});

test("a run's bash commands go to its own agent's shell, and the model reads what came back", async () => {
  const [agent] = await userAgent().listAgents();
  const agentId = agent?.id ?? "";
  const ran: { agentId: string; command: string }[] = [];
  scriptedModel.push(runBash("ls"), reply("ファイルが 1 つあります。"));

  await runInDurableObject(userAgent(), async (_, state) => {
    store.insertPost(
      state.storage,
      {
        id: crypto.randomUUID(),
        threadId: store.agentThreadId(state.storage, agentId) ?? "",
        agentId: null,
        callId: null,
        text: "何がある？",
        createdAt: new Date(),
      },
      [agentId],
    );
    await runDue(
      state.storage,
      testAgent,
      () => new Date(Date.now() + 1000),
      undefined,
      undefined,
      (run) => [
        bashTool({
          async run(command) {
            ran.push({ agentId: run.agentId, command });
            return { exitCode: 0, stdout: "notes.md\n", stderr: "", truncated: false };
          },
        }),
      ],
    );
  });

  expect(ran).toEqual([{ agentId, command: "ls" }]);
  expect(modelRequests[0]?.tools.map((tool) => tool.name)).toEqual(["bash"]);
  expect(modelRequests[1]?.messages.at(-1)).toEqual({
    role: "tool",
    callId: "call-1",
    isError: false,
    content: "exit code: 0\nstdout:\nnotes.md\n\nstderr:\n",
  });
});

test("a report says when a command was stopped or its output cut", () => {
  const stopped: ShellResult = { exitCode: 124, stdout: "", stderr: "", truncated: true };

  expect(shellReport(stopped)).toBe(
    "exit code: 124\n(stopped after 60 seconds)\n(output cut to its last 8 KB)\nstdout:\n\nstderr:\n",
  );
});

test("long output keeps its end", () => {
  const bytes = new TextEncoder().encode(`${"a".repeat(MAX_OUTPUT_BYTES)}end`);

  const kept = lastOutput(bytes);

  expect(kept.truncated).toBe(true);
  expect(kept.text).toHaveLength(MAX_OUTPUT_BYTES);
  expect(kept.text.endsWith("end")).toBe(true);
  expect(lastOutput(new TextEncoder().encode("short"))).toEqual({
    text: "short",
    truncated: false,
  });
});
