import { Cron } from "croner";

/** The hour, in the user's time zone, at which one of their days ends and the next begins. */
export const DAY_STARTS_AT_HOUR = 4;

/** The time zone the user's days are read in until their device sends its own. */
export const DEFAULT_TIME_ZONE = "Asia/Tokyo";

/** One of the user's days: from `DAY_STARTS_AT_HOUR` until the same hour the next day. */
export interface Day {
  /** The date the day begins on, in the user's time zone ("2026-11-12"). */
  readonly label: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** The day `at` falls in, read in `timeZone`. */
export function dayOf(at: Date, timeZone: string): Day {
  const starts = new Cron(`0 ${DAY_STARTS_AT_HOUR} * * *`, { timezone: timeZone, mode: "5-part" });
  const endsAt = starts.nextRun(at);
  const [startsAt] = endsAt === null ? [] : starts.previousRuns(1, endsAt);
  if (endsAt === null || startsAt === undefined) {
    throw new Error(`No day in ${timeZone} holds ${at.toISOString()}.`);
  }
  const label = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(startsAt);
  return { label, startsAt, endsAt };
}

/** The label of the day `count` days before the day labelled `label`. */
export function labelDaysBefore(label: string, count: number): string {
  const date = new Date(`${label}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, "YYYY-MM-DD".length);
}
