import { expect, test } from "vitest";
import clientScript from "../build/sign-in-client.txt";
import { signInPage } from "../src/sign-in/sign-in-page";

test("writes the handle into the page escaped", () => {
  const page = signInPage('a"><img src=x>', "nonce-1");

  expect(page).toContain('data-handle="a&quot;&gt;&lt;img src=x&gt;"');
  expect(page).not.toContain("<img");
});

test("inlines the browser script once, with the nonce, and nothing in it ends the tag early", () => {
  const page = signInPage("handle-1", "nonce-1");

  expect(page.startsWith('<!doctype html><html lang="ja">')).toBe(true);
  expect(page.match(/<script/g)).toEqual(["<script"]);
  expect(page).toContain(`<script nonce="nonce-1">${clientScript}</script>`);
  expect(clientScript).not.toContain("</script");
});
