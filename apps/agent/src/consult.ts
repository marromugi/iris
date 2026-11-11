import { defineTool, type Tool } from "@iris/agent";
import { z } from "zod";
import * as store from "./store";

/** How often a run waiting for an answer looks whether it has come. */
export const ANSWER_CHECK_MS = 250;

/**
 * Thrown from a tool when the wake-up runs out of time while the tool waits. The run stops where it
 * is, without a failure, and the same call runs again when the run is carried on.
 */
export class RunCut extends Error {
  constructor() {
    super("The wake-up ran out of time while the run waited.");
  }
}

/** What the consult tool needs from the wake-up carrying its run on. */
export interface ConsultContext {
  readonly storage: DurableObjectStorage;
  /** The run the tool is offered to. */
  readonly runId: string;
  readonly now: () => Date;
  readonly outOfTime: () => boolean;
  /** Tells the wake-up that a run became due, the one that answers. */
  readonly wake: () => void;
  /** Tells whoever watches that a question was asked in a consult, and its answer started. */
  readonly asked: (post: store.Post, answerRunId: string) => void;
  /** Called while the run waits for an answer, so the wake-up doesn't count it against its limit. */
  readonly waiting: (isWaiting: boolean) => void;
}

/**
 * The tool with which a run's agent asks another of the user's agents and waits for its answer,
 * which comes back as the tool's result. The question goes in a consult the user can read: one
 * thread per run and agent asked, so asking the same agent again in the run adds to it. A run in a
 * consult isn't offered the tool, so agents ask each other one hop deep. Undefined when there is no
 * one to ask.
 */
export function consultTool(context: ConsultContext): Tool | undefined {
  const { storage, runId } = context;
  const run = store.findRun(storage, runId);
  if (run === undefined || store.findThread(storage, run.threadId)?.consultRunId !== null) {
    return undefined;
  }
  const others = store.listAgents(storage).filter((agent) => agent.id !== run.agentId);
  if (others.length === 0) {
    return undefined;
  }
  const names = others.map((agent) => agent.name);
  return defineTool({
    name: "ask_agent",
    description: `Ask another of the user's agents a question and wait for its answer, which comes back as this tool's result. The user can read the exchange. The agents you can ask: ${names.join(", ")}.`,
    input: z.object({
      agent: z.string().trim().min(1).describe("The name of the agent to ask"),
      question: z.string().trim().min(1),
    }),
    async run({ agent, question }, call) {
      let answerRunId = store.consultAsked(storage, call.id)?.runId;
      if (answerRunId === undefined) {
        const answerer = others.find((each) => each.name === agent);
        if (answerer === undefined) {
          return {
            ok: false,
            error: `No agent is named "${agent}". You can ask: ${names.join(", ")}.`,
          };
        }
        const threadId = store.findConsult(storage, runId, answerer.id) ?? crypto.randomUUID();
        if (store.findThread(storage, threadId) === undefined) {
          store.insertConsult(storage, {
            id: threadId,
            runId,
            askerId: run.agentId,
            answererId: answerer.id,
            createdAt: context.now(),
          });
        }
        const post: store.Post = {
          id: crypto.randomUUID(),
          threadId,
          agentId: run.agentId,
          callId: call.id,
          text: question,
          createdAt: context.now(),
        };
        [answerRunId = ""] = store.insertPost(storage, post, [answerer.id]);
        context.asked(post, answerRunId);
        context.wake();
      }
      context.waiting(true);
      try {
        return await answer(context, answerRunId);
      } finally {
        context.waiting(false);
      }
    },
  });
}

/** Waits for the run to end and gives its reply, or why there is none. */
async function answer(context: ConsultContext, answerRunId: string) {
  for (;;) {
    const answered = store.answerOf(context.storage, answerRunId);
    if (answered.done) {
      return "reply" in answered
        ? { ok: true as const, content: answered.reply }
        : { ok: false as const, error: `No answer came: ${answered.failure}` };
    }
    if (context.outOfTime()) {
      throw new RunCut();
    }
    await new Promise((resolve) => setTimeout(resolve, ANSWER_CHECK_MS));
  }
}
