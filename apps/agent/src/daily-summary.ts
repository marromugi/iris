import type { Model } from "@iris/agent";
import { type Day, dayOf } from "./day";
import * as store from "./store";

/** How long after a failed attempt at a summary it is tried again. */
export const SUMMARY_RETRY_DELAY_MS = 5 * 60 * 1000;

/** How many failed attempts a summary gets before its day is passed over. */
export const MAX_SUMMARY_ATTEMPTS = 3;

/** What the model is told when it writes a day's summary. */
export const SUMMARY_PROMPT = `You write the daily summary of one thread in iris, where a user talks with their agents. You get what was said in the thread over one day. Write what an agent needs on a later day to carry on: what the user wanted, what came of it, and what is still open.

- Write in the language the thread is in. At most about 1,000 characters (500 words in English).
- Use these Markdown sections, headed in that language, and leave out one with nothing in it:
  - ## Asked and done: each request and what was done about it, with times of day when they help.
  - ## Learned and decided: facts about the user, their plans and preferences, and what was settled.
  - ## Open: what is unfinished or promised, and who is to do it.
  - ## Keywords: names, places, URLs, and file names someone may search for later, comma-separated.
- Leave out how answers were found, options that weren't chosen, and small talk.
- Write only the summary.`;

/** The next summary of a thread to write: its day, from when it starts, and when it is due. */
export interface DueSummary {
  readonly threadId: string;
  /** The day, starting no earlier than the end of the summary before it. */
  readonly day: Day;
  readonly dueAt: Date;
}

/**
 * The thread's next summary to write: one that failed and is to be tried again, or else the
 * earliest day after its latest summary that something happened on, due when the day ends.
 * Undefined when nothing waits to be summarized.
 */
export function nextSummary(
  storage: DurableObjectStorage,
  threadId: string,
  timeZone: string,
): DueSummary | undefined {
  const latest = store.latestDailySummary(storage, threadId);
  if (
    latest !== undefined &&
    latest.text === null &&
    latest.failedAttempts < MAX_SUMMARY_ATTEMPTS
  ) {
    return {
      threadId,
      day: { label: latest.day, startsAt: latest.startsAt, endsAt: latest.endsAt },
      dueAt: latest.retryAt ?? latest.endsAt,
    };
  }
  const from = latest?.endsAt ?? new Date(0);
  const first = store.firstActivityFrom(storage, threadId, from);
  if (first === undefined) {
    return undefined;
  }
  const day = dayOf(first, timeZone);
  return {
    threadId,
    day: { ...day, startsAt: day.startsAt < from ? from : day.startsAt },
    dueAt: day.endsAt,
  };
}

/**
 * The next summary of each thread that can be written once it is due: none of the thread's runs
 * that started before its day ended is still going.
 */
function writableSummaries(storage: DurableObjectStorage): DueSummary[] {
  const timeZone = store.userTimeZone(storage);
  return store.summarizedThreadIds(storage).flatMap((threadId) => {
    const due = nextSummary(storage, threadId, timeZone);
    return due === undefined || store.hasRunGoingFrom(storage, threadId, due.day.endsAt)
      ? []
      : [due];
  });
}

/**
 * The runs that wait for a summary before they start: those that started once a day of their
 * thread had ended whose summary can be written and isn't yet, so they read it. A summary waits
 * only for runs that started before its day ended, so the two never wait for each other.
 */
export function runsWaitingForSummaries(storage: DurableObjectStorage): string[] {
  return writableSummaries(storage).flatMap((due) =>
    store.unendedRunsStartedFrom(storage, due.threadId, due.day.endsAt),
  );
}

/** When the earliest summary that can be written is due; undefined when none can be. */
export function nextSummaryDueAt(storage: DurableObjectStorage): Date | undefined {
  const times = writableSummaries(storage).map((due) => due.dueAt.getTime());
  return times.length === 0 ? undefined : new Date(Math.min(...times));
}

/**
 * Writes each summary that is due, one after another, until none is or `outOfTime` says so,
 * calling `tried` after each attempt, so runs waiting for it can start. A failed attempt is tried again `SUMMARY_RETRY_DELAY_MS` later, until it has failed
 * `MAX_SUMMARY_ATTEMPTS` times and its day is passed over.
 */
export async function summarizeDue(
  storage: DurableObjectStorage,
  model: Model,
  now: () => Date,
  outOfTime: () => boolean,
  tried: () => void = () => {},
  keep: KeepFile = async () => {},
): Promise<void> {
  for (;;) {
    if (outOfTime()) {
      return;
    }
    const due = writableSummaries(storage).find(
      (summary) => summary.dueAt.getTime() <= now().getTime(),
    );
    if (due === undefined) {
      return;
    }
    const kept = await summarize(storage, model, due, now);
    tried();
    if (kept !== undefined) {
      await keepHistory(storage, due, kept.summary, keep);
    }
  }
}

/** Writes `text` to `key` in the bucket agents' workspaces live in. */
export type KeepFile = (key: string, text: string) => Promise<void>;

/**
 * Has the model write the day's summary and stores it, or records the failure. Returns what the
 * day's files are to hold once it is settled: written, or passed over (no summary); undefined
 * while it is to be tried again.
 */
async function summarize(
  storage: DurableObjectStorage,
  model: Model,
  due: DueSummary,
  now: () => Date,
): Promise<{ summary: string | undefined } | undefined> {
  const { threadId, day } = due;
  const row = { threadId, day: day.label, startsAt: day.startsAt, endsAt: day.endsAt };
  let written: string | undefined;
  try {
    const reply = await model({
      system: SUMMARY_PROMPT,
      messages: [{ role: "user", text: dayAsRead(storage, due) }],
      tools: [],
    });
    const text = reply.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("")
      .trim();
    if (text === "") {
      throw new Error("The model wrote an empty summary.");
    }
    store.saveDailySummary(storage, { ...row, text });
    written = text;
  } catch (error) {
    const failed = store.recordDailySummaryFailure(storage, row, {
      error: error instanceof Error ? error.message : String(error),
      retryAt: new Date(now().getTime() + SUMMARY_RETRY_DELAY_MS),
    });
    console.error(
      `The summary of thread ${threadId} for ${day.label} failed (attempt ${failed}).`,
      error,
    );
    if (failed < MAX_SUMMARY_ATTEMPTS) {
      return undefined;
    }
  }
  return { summary: written };
}

/**
 * Where a day of a thread is kept in each member's workspace, under `/workspace/history/`: an
 * agent's one-to-one thread at the top, a group under `groups/<thread ID>/`.
 */
function historyDirectory(storage: DurableObjectStorage, threadId: string): string {
  return store.findThread(storage, threadId)?.agentId == null
    ? `history/groups/${threadId}`
    : "history";
}

/**
 * Writes the day into the workspace of each agent of the thread: what was said as
 * `<day>.log.md`, and the summary, when there is one, as `<day>.md`, each starting with which day
 * and which thread it is. The files are copies of what storage holds; one that can't be written is
 * logged and left out.
 */
async function keepHistory(
  storage: DurableObjectStorage,
  due: DueSummary,
  summary: string | undefined,
  keep: KeepFile,
): Promise<void> {
  const thread = store.findThread(storage, due.threadId);
  if (thread === undefined) {
    return;
  }
  const heading = dayHeading(storage, due);
  const name = historyName(storage, due);
  const files = [
    { name: `${name}.log.md`, text: `${heading}\n\n${saidLines(storage, due)}\n` },
    ...(summary === undefined ? [] : [{ name: `${name}.md`, text: `${heading}\n\n${summary}\n` }]),
  ];
  const directory = historyDirectory(storage, due.threadId);
  const writes = thread.agentIds.flatMap((agentId) =>
    files.map(async (file) => {
      const key = `agents/${agentId}/${directory}/${file.name}`;
      try {
        await keep(key, file.text);
      } catch (error) {
        console.error(`Writing ${key} failed.`, error);
      }
    }),
  );
  await Promise.all(writes);
}

/**
 * The name the day's files take: its date, and after a time zone change gave an earlier summary of
 * the thread the same date, the date with how many of them there are ("2026-11-12-2").
 */
function historyName(storage: DurableObjectStorage, { threadId, day }: DueSummary): string {
  const same = store
    .dailySummariesOf(storage, threadId)
    .filter((summary) => summary.day === day.label && summary.endsAt < day.endsAt).length;
  return same === 0 ? day.label : `${day.label}-${same + 1}`;
}

/** The day of the thread as the model reads it to summarize: which day, which thread, and what was said, by time of day. */
function dayAsRead(storage: DurableObjectStorage, due: DueSummary): string {
  return `${dayHeading(storage, due)}\n\n${saidLines(storage, due)}`;
}

/** Which day, in which time zone, and which thread. */
function dayHeading(storage: DurableObjectStorage, { threadId, day }: DueSummary): string {
  const timeZone = store.userTimeZone(storage);
  return `Day: ${day.label} (${timeZone})\nThread: ${threadLine(storage, threadId)}`;
}

/** What was said in the thread that day, one line each, by time of day. */
function saidLines(storage: DurableObjectStorage, { threadId, day }: DueSummary): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: store.userTimeZone(storage),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return store
    .saidBetween(storage, threadId, day.startsAt, day.endsAt)
    .map((line) => `[${time.format(line.at)}] ${line.speaker}: ${line.text}`)
    .join("\n");
}

function threadLine(storage: DurableObjectStorage, threadId: string): string {
  const thread = store.findThread(storage, threadId);
  if (thread?.agentId != null) {
    const agent = store.listAgents(storage).find((each) => each.id === thread.agentId);
    return `one-to-one between the user and ${agent?.name ?? "an agent"}`;
  }
  return `group "${thread?.name ?? ""}"`;
}
