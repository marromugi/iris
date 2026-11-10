import { expect, test } from "vitest";
import { repliers } from "../src/mentions";

const members = [
  { id: "mail", name: "メール" },
  { id: "mail-digest", name: "メールまとめ" },
  { id: "stocks", name: "株価" },
];

test("every member replies to a post that names nobody with @", () => {
  expect(repliers("みんな今日の予定は？", members)).toEqual(["mail", "mail-digest", "stocks"]);
  expect(repliers("@誰か いますか", members)).toEqual(["mail", "mail-digest", "stocks"]);
});

test("only the members named with @ reply, in the order they are named, each once", () => {
  expect(repliers("@株価 と @メール お願い。@株価 急ぎで", members)).toEqual(["stocks", "mail"]);
});

test("the longer name is meant where one name begins another", () => {
  expect(repliers("@メールまとめ 今日の分", members)).toEqual(["mail-digest"]);
  expect(repliers("@メール 今日の分", members)).toEqual(["mail"]);
});
