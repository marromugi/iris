import { expect, test } from "vitest";
import { dayOf, labelDaysBefore } from "../src/day";

test("a day runs from 4:00 to 4:00 in the time zone, so 3:59 is still the day before", () => {
  const day = {
    label: "2026-11-12",
    startsAt: new Date("2026-11-12T04:00:00+09:00"),
    endsAt: new Date("2026-11-13T04:00:00+09:00"),
  };

  expect(dayOf(new Date("2026-11-12T04:00:00+09:00"), "Asia/Tokyo")).toEqual(day);
  expect(dayOf(new Date("2026-11-12T23:30:00+09:00"), "Asia/Tokyo")).toEqual(day);
  expect(dayOf(new Date("2026-11-13T03:59:59.999+09:00"), "Asia/Tokyo")).toEqual(day);
  expect(dayOf(new Date("2026-11-13T04:00:00+09:00"), "Asia/Tokyo").label).toBe("2026-11-13");
});

test("the day clocks go back on is 25 hours long, and the one they go forward on 23", () => {
  expect(dayOf(new Date("2026-10-31T12:00:00-04:00"), "America/New_York")).toEqual({
    label: "2026-10-31",
    startsAt: new Date("2026-10-31T04:00:00-04:00"),
    endsAt: new Date("2026-11-01T04:00:00-05:00"),
  });
  expect(dayOf(new Date("2026-03-07T12:00:00-05:00"), "America/New_York")).toEqual({
    label: "2026-03-07",
    startsAt: new Date("2026-03-07T04:00:00-05:00"),
    endsAt: new Date("2026-03-08T04:00:00-04:00"),
  });
});

test("a label some days before another crosses months, years, and leap days", () => {
  expect(labelDaysBefore("2027-01-03", 7)).toBe("2026-12-27");
  expect(labelDaysBefore("2028-03-01", 1)).toBe("2028-02-29");
  expect(labelDaysBefore("2026-03-01", 1)).toBe("2026-02-28");
});
