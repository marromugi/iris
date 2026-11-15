import { nextAction, type Message, toolCalls } from "@iris/agent";
import { z } from "zod";

export const ASK_USER_TOOL = "ask_user";

/** How many choices a question offers. The user can also write an answer of their own. */
export const MIN_CHOICES = 2;
export const MAX_CHOICES = 4;

/** The longest answer taken, in characters. */
export const MAX_ANSWER_LENGTH = 4000;

/** What an agent asks the user with `ask_user`. */
export const questionSchema = z.object({
  question: z.string().trim().min(1).describe("The question, standing on its own"),
  choices: z
    .array(
      z.object({
        label: z.string().trim().min(1).describe("A short answer, a few words"),
        description: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("What choosing it means, when the label doesn't say"),
      }),
    )
    .min(MIN_CHOICES)
    .max(MAX_CHOICES)
    .describe("The likely answers, the one you would pick first"),
  multiSelect: z
    .boolean()
    .default(false)
    .describe("Whether the user may pick more than one choice"),
});

export type Question = z.output<typeof questionSchema>;

/** What the user sends to answer a run's question. */
export const newAnswerSchema = z.object({
  answer: z
    .string()
    .trim()
    .min(1)
    .max(MAX_ANSWER_LENGTH)
    .describe("The choices picked, or the user's own answer, as the agent reads it"),
});

/** A question an agent asked with `ask_user` and the user's answer to it. */
export interface Asked {
  readonly question: string;
  readonly answer: string;
}

/**
 * The questions the conversation asked with `ask_user` that were answered, in order. A call that
 * failed, such as one with invalid input, asked nothing.
 */
export function answeredQuestions(messages: readonly Message[]): Asked[] {
  const asked = new Map<string, string>();
  const answered: Asked[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of toolCalls(message)) {
        const parsed = questionSchema.safeParse(call.input);
        if (call.name === ASK_USER_TOOL && parsed.success) {
          asked.set(call.id, parsed.data.question);
        }
      }
    } else if (message.role === "tool" && !message.isError) {
      const question = asked.get(message.callId);
      if (question !== undefined) {
        answered.push({ question, answer: message.content });
      }
    }
  }
  return answered;
}

/** The question the conversation waits on: its next call waiting for a result is `ask_user`. */
export function waitingQuestion(messages: readonly Message[]): Question | undefined {
  const next = messages.length === 0 ? undefined : nextAction(messages);
  if (next?.type !== "run-tool" || next.call.name !== ASK_USER_TOOL) {
    return undefined;
  }
  const parsed = questionSchema.safeParse(next.call.input);
  return parsed.success ? parsed.data : undefined;
}
