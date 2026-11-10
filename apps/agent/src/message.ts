import { z } from "zod";

/** What a user sends to an agent: the text the run it starts begins with. */
export const newMessageSchema = z.object({
  text: z.string().trim().min(1),
});

export type NewMessage = z.input<typeof newMessageSchema>;
