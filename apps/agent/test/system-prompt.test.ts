import type { AssistantMessage, ModelRequest } from "@iris/agent";
import { reset, runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import { modelRequests, scriptedModel } from "./worker";

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
  expect(placeOf(asking)).toMatch(
    /^Current time: \d{4}-\d\d-\d\dT[\d:.]+Z\. Thread: one-to-one with the user\.$/,
  );
  expect(answering?.system).toMatch(/^You are 株価,/);
  expect(placeOf(answering)).toMatch(/Thread: consult, where エージェント is asking you\.$/);

  modelRequests.length = 0;
  const group = await userAgent().addGroup({ name: "チーム", agentIds: [first?.id ?? "", stocks] });
  if (!group.ok) {
    throw new Error(group.error);
  }
  scriptedModel.push(reply("はい。"));
  await userAgent().post(group.thread.id, { text: "@株価 どう？" });
  await runDurableObjectAlarm(userAgent());

  expect(modelRequests.map(placeOf)).toEqual([expect.stringMatching(/Thread: group "チーム"\.$/)]);
});
