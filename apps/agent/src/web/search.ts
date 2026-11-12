import { defineTool, type Tool } from "@iris/agent";
import { z } from "zod";
import { untrusted } from "../untrusted";

/** How many searches a user's agents make a month at most, before Exa's free credit would run out. */
export const MAX_SEARCHES_PER_MONTH = 1000;

/** What the web tools call the text they hand the model. */
export const WEB_CONTENT = "web content";

/** How many results one search gives back. */
export const SEARCH_RESULTS = 5;

/** About how much of a result's description the model reads, in characters; Exa's can run to a page. */
export const MAX_DESCRIPTION = 300;

/** One result of a search. */
export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly description: string;
}

/** Where searches go. Throws `SearchRefused` when the search service won't search, with why. */
export interface Searcher {
  search(query: string): Promise<SearchResult[]>;
}

/** The search service turned the search down, as when its credit for the month ran out. */
export class SearchRefused extends Error {}

/** Counts a user's searches by month, so they stop at `MAX_SEARCHES_PER_MONTH`. */
export interface SearchCounter {
  /** Counts one search in `month` ("2026-11") and gives the count with it. */
  count(month: string): number;
}

/**
 * The tool with which an agent searches the web. Each search is counted for the month; past
 * `MAX_SEARCHES_PER_MONTH` the tool says the month's searches are used up instead of searching.
 */
export function searchTool(searcher: Searcher, counter: SearchCounter, now: () => Date): Tool {
  return defineTool({
    name: "web_search",
    description: `Search the web and get the top ${SEARCH_RESULTS} results, each with its title, URL, and a short description. Open a result with browser_open to read it.`,
    input: z.object({ query: z.string().trim().min(1).max(1024).describe("What to search for") }),
    async run({ query }) {
      const month = now().toISOString().slice(0, 7);
      if (counter.count(month) > MAX_SEARCHES_PER_MONTH) {
        return {
          ok: false,
          error: `This month's ${MAX_SEARCHES_PER_MONTH} web searches are used up; tell the user, and answer without searching.`,
        };
      }
      try {
        const results = await searcher.search(query);
        return { ok: true, content: searchReport(results) };
      } catch (error) {
        // A search that fails is the service's trouble, not a reason to fail the run.
        const reason = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error:
            error instanceof SearchRefused
              ? `The web search was turned down: ${reason}`
              : `The web search failed: ${reason}`,
        };
      }
    },
  });
}

/**
 * What the model reads of a search's results, marked as coming from the web: what they say is for
 * the model to weigh, not to do.
 */
export function searchReport(results: readonly SearchResult[]): string {
  if (results.length === 0) {
    return "No results.";
  }
  return untrusted(
    WEB_CONTENT,
    results
      .map((result, index) =>
        [`${index + 1}. ${result.title}`, `   ${result.url}`]
          .concat(result.description === "" ? [] : [`   ${result.description}`])
          .join("\n"),
      )
      .join("\n\n"),
  );
}

/** Searches with Cloudflare's Web Search API through the account's default AI Gateway, with Exa and the key stored there. */
export function exaSearcher(ai: Ai): Searcher {
  return {
    async search(query) {
      const response = await ai.websearch({
        gatewayId: "default",
        provider: "exa",
        query,
        limit: SEARCH_RESULTS,
      });
      if (!response.ok) {
        throw new SearchRefused(`${response.status} ${await response.text()}`);
      }
      const body = searchResponseSchema.parse(await response.json());
      return body.items.map((item) => ({
        title: oneLine(item.title ?? "") || hostOf(item.url),
        url: item.url,
        description: cleanDescription(item.description ?? ""),
      }));
    },
  };
}

const searchResponseSchema = z.object({
  items: z.array(
    z.object({ url: z.string(), title: z.string().nullish(), description: z.string().nullish() }),
  ),
});

/** Lines of a page that are its chrome rather than what it says. */
const CHROME_LINE =
  /^(last updated\b|copy as markdown\b|view as markdown\b|skip to (main )?content\b|on this page\b|table of contents\b)/i;

/**
 * A description as one plain paragraph: code blocks, table rows and page chrome dropped, Markdown
 * marks taken off with link texts kept, whitespace run together, and cut at the last sentence end
 * before `MAX_DESCRIPTION` characters (or at that length when no sentence ends before it), marked
 * with "…" when cut.
 */
export function cleanDescription(description: string): string {
  const lines: string[] = [];
  let inCode = false;
  for (const raw of description.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode || line.includes("|") || CHROME_LINE.test(line)) {
      continue;
    }
    lines.push(
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^([-*+]|\d+\.)\s+/, "")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__|\*|_|`)/g, ""),
    );
  }
  const text = oneLine(lines.join(" "));
  if (text.length <= MAX_DESCRIPTION) {
    return text;
  }
  const head = text.slice(0, MAX_DESCRIPTION);
  const ends = [...head.matchAll(/[。.!?！？](?=\s|$)|[。！？]/g)];
  const lastEnd = ends.at(-1);
  const cut =
    lastEnd === undefined ? head : head.slice(0, (lastEnd.index ?? 0) + lastEnd[0].length);
  return `${cut.trimEnd()} …`;
}

/** Text with its line breaks and runs of whitespace made single spaces. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A URL's host, for a result without a title. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
