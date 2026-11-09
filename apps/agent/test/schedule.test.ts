import { expect, test } from "vitest";
import { nextRunAt, scheduleSchema } from "../src/schedule";

test("reads the cron expression in the schedule's time zone", () => {
  const schedule = scheduleSchema.parse({ cron: "0 8 * * *", timeZone: "Asia/Tokyo" });

  expect(nextRunAt(schedule, new Date("2026-11-09T22:59:00Z")).toISOString()).toBe(
    "2026-11-09T23:00:00.000Z",
  );
  expect(nextRunAt(schedule, new Date("2026-11-09T23:00:00Z")).toISOString()).toBe(
    "2026-11-10T23:00:00.000Z",
  );
});

test("rejects schedules that can't run", () => {
  expect(scheduleSchema.safeParse({ cron: "0 0 8 * * *", timeZone: "UTC" }).success).toBe(false);
  expect(scheduleSchema.safeParse({ cron: "0 0 30 2 *", timeZone: "UTC" }).success).toBe(false);
});
