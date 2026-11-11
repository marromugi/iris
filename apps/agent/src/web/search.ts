import { defineTool, type Tool } from "@iris/agent";
import { z } from "zod";

/** How many searches a user's agents make a month at most, before Exa's free credit would run out. */
export const MAX_SEARCHES_PER_MONTH = 1000;

/** How many results one search gives back. */
export const SEARCH_RESULTS = 5;

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
        if (error instanceof SearchRefused) {
          return { ok: false, error: `The web search was turned down: ${error.message}` };
        }
        throw error;
      }
    },
  });
}

/** What the model reads of a search's results. */
export function searchReport(results: readonly SearchResult[]): string {
  if (results.length === 0) {
    return "No results.";
  }
  return results
    .map((result, index) => `${index + 1}. ${result.title}\n${result.url}\n${result.description}`)
    .join("\n\n");
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
        title: item.title ?? item.url,
        url: item.url,
        description: item.description ?? "",
      }));
    },
  };
}

const searchResponseSchema = z.object({
  items: z.array(
    z.object({ url: z.string(), title: z.string().optional(), description: z.string().optional() }),
  ),
});
