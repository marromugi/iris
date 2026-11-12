const TAG_END = /[<>]/g;

/** Elements whose content is never text. */
const SKIPPED_ELEMENTS: ReadonlySet<string> = new Set(["head", "style", "script"]);

/** Elements after whose end the text goes on in a new line. */
const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  "p",
  "div",
  "tr",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "blockquote",
]);

/**
 * The text of an HTML body: no markup, a line break where a block ends, a space between table
 * cells, a link's address after its text, and numeric and common named entities written out. It
 * reads the HTML once from start to end, so its time grows with the HTML's length and no faster,
 * since a mail's HTML is written by anyone.
 */
export function htmlText(html: string): string {
  const lower = html.toLowerCase();
  const parts: string[] = [];
  /** The address of the link being read, and where its text starts in `parts`. */
  let link: { address: string; from: number } | undefined;
  let at = 0;
  while (at < html.length) {
    const open = html.indexOf("<", at);
    if (open === -1) {
      parts.push(html.slice(at));
      break;
    }
    parts.push(html.slice(at, open));
    if (lower.startsWith("<!--", open)) {
      at = endAfter(lower, "-->", open + 4);
      continue;
    }
    // A tag ends at the first ">" before any other "<"; a "<" without one is text.
    TAG_END.lastIndex = open + 1;
    const close = TAG_END.exec(html)?.index;
    if (close === undefined || html[close] === "<") {
      parts.push("<");
      at = open + 1;
      continue;
    }
    const tag = html.slice(open + 1, close);
    const name = /^\/?([a-z][a-z0-9]*)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const closing = tag.startsWith("/");
    at = close + 1;
    if (!closing && SKIPPED_ELEMENTS.has(name)) {
      const end = lower.indexOf(`</${name}`, at);
      at = end === -1 ? html.length : endAfter(lower, ">", end);
    } else if (name === "br" || (closing && BLOCK_ELEMENTS.has(name))) {
      parts.push("\n");
    } else if (closing && (name === "td" || name === "th")) {
      parts.push(" ");
    } else if (name === "a" && !closing) {
      const address = /\bhref\s*=\s*["']?(https?:[^"'\s>]+)/i.exec(tag)?.[1];
      link = address === undefined ? undefined : { address, from: parts.length };
    } else if (name === "a" && link !== undefined) {
      const shown = decodeEntities(parts.slice(link.from).join("")).trim();
      const address = decodeEntities(link.address);
      if (shown !== address) {
        parts.push(shown === "" ? address : ` (${address})`);
      }
      link = undefined;
    }
  }
  return decodeEntities(parts.join(""))
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function endAfter(lower: string, end: string, from: number): number {
  const found = lower.indexOf(end, from);
  return found === -1 ? lower.length : found + end.length;
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, name: string) => entityText(name) ?? entity,
  );
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  yen: "¥",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

function entityText(name: string): string | undefined {
  if (name.startsWith("#")) {
    const code =
      name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : undefined;
  }
  return NAMED_ENTITIES[name.toLowerCase()];
}
