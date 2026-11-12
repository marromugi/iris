import { expect, test } from "vitest";
import { htmlText } from "../src/mail/html-text";

test("HTML becomes its text, a block or a cell apart from the next", () => {
  expect(
    htmlText(
      "<html><head><title>T</title><style>p{}</style></head><body><!-- if a > b -->" +
        "<p>Sale <b>today</b> &amp; &yen;100&hellip;</p><table><tr><td>Item</td><td>2</td></tr></table>" +
        "<script>alert(1)</script>Thanks<br>Shop</body></html>",
    ),
  ).toBe("Sale today & ¥100…\nItem 2\n\nThanks\nShop");
});

test("a link keeps its address after its text, once", () => {
  expect(
    htmlText(
      '<a href="https://example.com/verify?c=1&amp;d=2">Confirm <b>here</b></a> or ' +
        "<a href='https://example.com/x'>https://example.com/x</a> or <a href=https://e.com/i><img></a>",
    ),
  ).toBe(
    "Confirm here (https://example.com/verify?c=1&d=2) or https://example.com/x or https://e.com/i",
  );
});

test("HTML never closed reads to its end as text or as nothing", () => {
  expect(htmlText("a < b and <style>hidden")).toBe("a < b and ");
  expect(htmlText("x <!-- open")).toBe("x ");
});

test("HTML a sender shaped to be slow reads in time that grows with its length", () => {
  const shaped = [
    "<".repeat(200_000),
    "<br".repeat(100_000),
    `<a href=http:${"x".repeat(200_000)}`,
    `${"<a href=https://a ".repeat(20_000)}>`,
    "<style>".repeat(50_000),
    "<!--".repeat(50_000),
  ];
  const started = performance.now();
  for (const html of shaped) {
    htmlText(html);
  }
  expect(performance.now() - started).toBeLessThan(2000);
});
