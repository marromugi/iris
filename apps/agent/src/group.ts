import { z } from "zod";
import { MAX_AGENT_NAME_LENGTH } from "./agent";

/** What a user gives to make a group: its name, and two or more of their agents, each once. */
export const newGroupSchema = z.object({
  name: z.string().trim().min(1).max(MAX_AGENT_NAME_LENGTH),
  agentIds: z
    .array(z.uuid())
    .min(2)
    .refine((ids) => new Set(ids).size === ids.length, "An agent is named more than once"),
});

export type NewGroup = z.input<typeof newGroupSchema>;
