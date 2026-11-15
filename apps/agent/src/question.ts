import { nextAction, type Message } from "@iris/agent";
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

/** The question the conversation waits on: its next call waiting for a result is `ask_user`. */
export function waitingQuestion(messages: readonly Message[]): Question | undefined {
  const next = messages.length === 0 ? undefined : nextAction(messages);
  if (next?.type !== "run-tool" || next.call.name !== ASK_USER_TOOL) {
    return undefined;
  }
  const parsed = questionSchema.safeParse(next.call.input);
  return parsed.success ? parsed.data : undefined;
}
