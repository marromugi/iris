import { Cron } from "croner";
import { z } from "zod";

function cronFor(schedule: { cron: string; timeZone: string }): Cron {
  return new Cron(schedule.cron, { timezone: schedule.timeZone, mode: "5-part" });
}

function isTimeZone(value: string): boolean {
  try {
    const format = new Intl.DateTimeFormat("en-US", { timeZone: value });
    return format.resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
}

function hasNextRun(schedule: { cron: string; timeZone: string }): boolean {
  try {
    return cronFor(schedule).nextRun() !== null;
  } catch {
    return false;
  }
}

/** A repeating time: a five-field cron expression read in an IANA time zone such as "Asia/Tokyo". */
export const scheduleSchema = z
  .object({
    cron: z.string().trim().min(1),
    timeZone: z.string().refine(isTimeZone, "Not a known IANA time zone."),
  })
  .refine(hasNextRun, {
    message: "Not a five-field cron expression that ever comes round.",
    path: ["cron"],
    when: (payload) => payload.issues.length === 0,
  });

export type Schedule = z.infer<typeof scheduleSchema>;

/** The first time the schedule comes round strictly after `after`. */
export function nextRunAt(schedule: Schedule, after: Date): Date {
  const next = cronFor(schedule).nextRun(after);
  if (next === null) {
    throw new Error(
      `Schedule "${schedule.cron}" (${schedule.timeZone}) has no run after ${after.toISOString()}.`,
    );
  }
  return next;
}
