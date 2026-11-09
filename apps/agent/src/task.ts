import { z } from "zod";
import { scheduleSchema } from "./schedule";

/** What a user gives to add a task: the prompt each run starts with, and when it runs. */
export const newTaskSchema = z.object({
  prompt: z.string().trim().min(1),
  schedule: scheduleSchema,
});

export type NewTask = z.input<typeof newTaskSchema>;
