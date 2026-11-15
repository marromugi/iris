import { defineTool, nextAction, type Tool } from "@iris/agent";
import { ASK_USER_TOOL, questionSchema } from "./question";
import * as store from "./store";

/**
 * Thrown from `ask_user` to stop the run where it is, without a failure, until the user answers.
 * The run then isn't due until `answerQuestion` gives the call its result.
 */
export class AwaitingAnswer extends Error {
  constructor() {
    super("The run waits for the user to answer its question.");
  }
}

/**
 * The tool with which a run's agent asks the user a question and waits, however long it takes,
 * for the answer, which comes back as the tool's result. Offered only in the agent's one-to-one
 * thread: undefined in a group and in a consult.
 */
export function askUserTool(storage: DurableObjectStorage, runId: string): Tool | undefined {
  const run = store.findRun(storage, runId);
  if (run === undefined || store.findThread(storage, run.threadId)?.agentId === null) {
    return undefined;
  }
  return defineTool({
    name: ASK_USER_TOOL,
    description:
      "Ask the user a question with a few choices, and wait for the answer, which comes back as this tool's result. The user can also write their own answer. The run waits until they answer, however long that is.",
    input: questionSchema,
    async run() {
      throw new AwaitingAnswer();
    },
  });
}

/** Why an answer is refused: the run isn't waiting on a question, having ended or never asked. */
export const NOT_WAITING = "The run isn't waiting for an answer.";

/**
 * Gives the run's waiting `ask_user` call `answer`, already checked by `newAnswerSchema`, as its
 * result, and makes the run due at `now`. Returns `ok: false` when the run isn't waiting for an
 * answer.
 */
export function answerQuestion(
  storage: DurableObjectStorage,
  runId: string,
  answer: string,
  now: Date,
): { ok: true } | { ok: false; error: string } {
  const run = store.findRun(storage, runId);
  if (run === undefined || !run.waitsForAnswer) {
    return { ok: false, error: NOT_WAITING };
  }
  const next = nextAction(run.messages);
  if (next.type !== "run-tool" || next.call.name !== ASK_USER_TOOL) {
    throw new Error(`Run ${runId} waits for an answer, but its next step isn't an ask_user call.`);
  }
  store.appendMessage(storage, runId, run.messages.length, {
    role: "tool",
    callId: next.call.id,
    isError: false,
    content: answer,
  });
  store.postponeRun(storage, runId, now);
  return { ok: true };
}
