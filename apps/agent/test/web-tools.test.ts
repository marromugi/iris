import type { AssistantMessage } from "@iris/agent";
import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import { runDue } from "../src/runner";
import * as store from "../src/store";
import { isBlocked } from "../src/web/blocked-hosts";
import { browserTools, type PageView, type WebBrowser } from "../src/web/browser";
import {
  MAX_DESCRIPTION,
  MAX_SEARCHES_PER_MONTH,
  SearchRefused,
  searchTool,
  shortened,
  untrusted,
} from "../src/web/search";
import { modelRequests, scriptedModel, testAgent } from "./worker";

afterEach(async () => {
  scriptedModel.length = 0;
  modelRequests.length = 0;
  await reset();
});

const userAgent = () => env.USER_AGENT.getByName("user-1");
const call = { id: "call-1" };
const now = () => new Date("2026-11-12T09:00:00Z");

const page = (url: string, links: string[] = []): PageView => ({
  url,
  title: `Title of ${url}`,
  text: `Text of ${url}`,
  links: links.map((href, index) => ({ text: `Link ${index + 1}`, url: href })),
});

/** A browser that serves `page(url, links)` for every URL, keeping what it opened. */
function fakeBrowser(links: Record<string, string[]> = {}) {
  const opened: string[] = [];
  let current: PageView | undefined;
  const browser: WebBrowser = {
    async open(url) {
      if (url.includes("broken")) {
        throw new Error("net::ERR_NAME_NOT_RESOLVED");
      }
      opened.push(url);
      current = page(url, links[url]);
      return current;
    },
    async read() {
      return current;
    },
    async close() {},
  };
  return { browser, opened };
}

const tool = (tools: ReturnType<typeof browserTools>, name: string) => {
  const found = tools.find((each) => each.name === name);
  if (found === undefined) {
    throw new Error(`No tool ${name}.`);
  }
  return found;
};

test("a search gives back its results, counted for the month", async () => {
  const counted: string[] = [];
  const search = searchTool(
    {
      search: async (query) => [
        { title: "Workers", url: "https://example.com/workers", description: `About ${query}` },
      ],
    },
    { count: (month) => counted.push(month) },
    now,
  );

  const outcome = await search.run({ query: "Cloudflare" }, call);

  expect(outcome).toEqual({
    ok: true,
    content: untrusted("1. Workers\nhttps://example.com/workers\nAbout Cloudflare"),
  });
  expect(counted).toEqual(["2026-11"]);
});

test("the month's last search still searches", async () => {
  let searched = false;
  const search = searchTool(
    {
      async search() {
        searched = true;
        return [];
      },
    },
    { count: () => MAX_SEARCHES_PER_MONTH },
    now,
  );

  expect((await search.run({ query: "Cloudflare" }, call)).ok).toBe(true);
  expect(searched).toBe(true);
});

test("a search that fails in any way comes back as the tool's error, not a failed run", async () => {
  const search = searchTool(
    { search: () => Promise.reject(new Error("web_search_unavailable")) },
    { count: () => 1 },
    now,
  );

  expect(await search.run({ query: "Cloudflare" }, call)).toEqual({
    ok: false,
    error: "The web search failed: web_search_unavailable",
  });
});

test("past the month's searches the tool says so without searching", async () => {
  let searched = false;
  const search = searchTool(
    {
      async search() {
        searched = true;
        return [];
      },
    },
    { count: () => MAX_SEARCHES_PER_MONTH + 1 },
    now,
  );

  const outcome = await search.run({ query: "Cloudflare" }, call);

  expect(outcome.ok).toBe(false);
  expect(searched).toBe(false);
});

test("a search the service turns down, as when its credit ran out, comes back as the tool's error", async () => {
  const search = searchTool(
    { search: () => Promise.reject(new SearchRefused("402 web_search_payment_required")) },
    { count: () => 1 },
    now,
  );

  expect(await search.run({ query: "Cloudflare" }, call)).toEqual({
    ok: false,
    error: "The web search was turned down: 402 web_search_payment_required",
  });
});

test("searches are counted per month in the user's storage", async () => {
  const counts = await runInDurableObject(userAgent(), (_, state) => [
    store.countSearch(state.storage, "2026-11"),
    store.countSearch(state.storage, "2026-11"),
    store.countSearch(state.storage, "2026-12"),
  ]);

  expect(counts).toEqual([1, 2, 1]);
});

test("a page opened shows its text and numbered links, and following one stays in the same browser", async () => {
  const { browser, opened } = fakeBrowser({
    "https://example.com/": ["https://example.com/a", "https://example.com/b"],
  });
  const tools = browserTools(browser);

  const first = await tool(tools, "browser_open").run({ url: "https://example.com/" }, call);
  const followed = await tool(tools, "browser_follow").run({ link: 2 }, call);
  const missing = await tool(tools, "browser_follow").run({ link: 5 }, call);

  expect(first).toEqual({
    ok: true,
    content: untrusted(
      "Title of https://example.com/\nhttps://example.com/\n\nText of https://example.com/\n\nLinks:\n[1] Link 1 — https://example.com/a\n[2] Link 2 — https://example.com/b",
    ),
  });
  expect(followed.ok).toBe(true);
  expect(opened).toEqual(["https://example.com/", "https://example.com/b"]);
  expect(missing).toEqual({ ok: false, error: "The page open has no links." });
});

test("a page that can't be opened, or reading with none open, comes back as the tool's error", async () => {
  const tools = browserTools(fakeBrowser().browser);

  expect(await tool(tools, "browser_read").run({}, call)).toEqual({
    ok: false,
    error: "No page is open; open one with browser_open first.",
  });
  expect(await tool(tools, "browser_open").run({ url: "https://broken.example/" }, call)).toEqual({
    ok: false,
    error: "The page couldn't be opened: net::ERR_NAME_NOT_RESOLVED",
  });
  expect(tool(tools, "browser_open").input.safeParse({ url: "file:///etc/passwd" }).success).toBe(
    false,
  );
});

test("following with no page open says to open one", async () => {
  const tools = browserTools(fakeBrowser().browser);

  expect(await tool(tools, "browser_follow").run({ link: 1 }, call)).toEqual({
    ok: false,
    error: "No page is open; open one with browser_open first.",
  });
});

test("a run's tools let go of what they hold once the run stops", async () => {
  const [agent] = await userAgent().listAgents();
  const agentId = agent?.id ?? "";
  let released = 0;
  scriptedModel.push({
    role: "assistant",
    parts: [{ type: "text", text: "はい。" }],
  } satisfies AssistantMessage);

  await runInDurableObject(userAgent(), async (_, state) => {
    store.insertPost(
      state.storage,
      {
        id: crypto.randomUUID(),
        threadId: store.agentThreadId(state.storage, agentId) ?? "",
        agentId: null,
        callId: null,
        text: "Hi",
        createdAt: new Date(),
      },
      [agentId],
    );
    await runDue(
      state.storage,
      testAgent,
      () => new Date(Date.now() + 1000),
      undefined,
      undefined,
      () => ({
        tools: [],
        release: async () => {
          released += 1;
        },
      }),
    );
  });

  expect(released).toBe(1);
});

test("a run that fails lets go of its tools too", async () => {
  const [agent] = await userAgent().listAgents();
  const agentId = agent?.id ?? "";
  let released = 0;
  scriptedModel.push(new Error("The model service is unreachable."));

  await runInDurableObject(userAgent(), async (_, state) => {
    store.insertPost(
      state.storage,
      {
        id: crypto.randomUUID(),
        threadId: store.agentThreadId(state.storage, agentId) ?? "",
        agentId: null,
        callId: null,
        text: "Hi",
        createdAt: new Date(),
      },
      [agentId],
    );
    await runDue(
      state.storage,
      testAgent,
      () => new Date(Date.now() + 1000),
      undefined,
      undefined,
      () => ({
        tools: [],
        release: async () => {
          released += 1;
        },
      }),
    );
  });

  expect(released).toBe(1);
});

test("hosts on the list, their subdomains, and bare IP addresses are blocked; others aren't", () => {
  expect(isBlocked("https://webhook.site/abc?d=secret")).toBe(true);
  expect(isBlocked("https://x.y.ngrok-free.app/")).toBe(true);
  expect(isBlocked("https://WEBHOOK.SITE./")).toBe(true);
  expect(isBlocked("http://203.0.113.7/collect")).toBe(true);
  expect(isBlocked("http://[2001:db8::1]/")).toBe(true);
  expect(isBlocked("https://notwebhook.site/")).toBe(false);
  expect(isBlocked("https://developers.cloudflare.com/")).toBe(false);
});

test("the tools refuse a blocked URL, opened or followed, without reaching it", async () => {
  const { browser, opened } = fakeBrowser({
    "https://example.com/": ["https://pastebin.com/raw/abc"],
  });
  const tools = browserTools(browser);

  const direct = await tool(tools, "browser_open").run({ url: "https://webhook.site/x?d=1" }, call);
  await tool(tools, "browser_open").run({ url: "https://example.com/" }, call);
  const followed = await tool(tools, "browser_follow").run({ link: 1 }, call);

  expect(direct.ok).toBe(false);
  expect(followed.ok).toBe(false);
  expect(opened).toEqual(["https://example.com/"]);
});

test("a long description is cut to its start", () => {
  expect(shortened("a".repeat(MAX_DESCRIPTION + 10))).toBe(`${"a".repeat(MAX_DESCRIPTION)}…`);
  expect(shortened("short")).toBe("short");
});
