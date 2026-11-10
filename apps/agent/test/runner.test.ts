import type { Message } from "@iris/agent";
import { expect, test } from "vitest";
import { earlierMessages } from "../src/runner";

const exchange = (question: string, ...answers: string[]): Message[] => [
  { role: "user", text: question },
  ...answers.map((text): Message => ({ role: "assistant", parts: [{ type: "text", text }] })),
];

test("takes the latest whole runs that fit, and none older than one that doesn't", () => {
  const latest = exchange("Latest", "Fine.");
  const long = exchange("Long", "One.", "Two.", "Three.");
  const oldest = exchange("Oldest", "Fine.");

  expect(earlierMessages([latest, long, oldest], 5)).toEqual(latest);
  expect(earlierMessages([latest, long, oldest], 8)).toEqual([...oldest, ...long, ...latest]);
});
