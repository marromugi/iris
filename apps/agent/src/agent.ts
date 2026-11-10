import { z } from "zod";

/** What a user gives to add an agent: the name the app lists it by. */
export const newAgentSchema = z.object({
  name: z.string().trim().min(1).max(50),
});

export type NewAgent = z.input<typeof newAgentSchema>;
