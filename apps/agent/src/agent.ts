import { z } from "zod";

/** The longest name an agent can have, counted in UTF-16 code units after trimming. */
export const MAX_AGENT_NAME_LENGTH = 40;

/** What a user gives to add an agent: its name. */
export const newAgentSchema = z.object({
  name: z.string().trim().min(1).max(MAX_AGENT_NAME_LENGTH),
});

export type NewAgent = z.input<typeof newAgentSchema>;
