import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import * as entry from "../src/index";

test("the Worker's module exports only what the runtime can start", () => {
  const notStartable = Object.entries(entry)
    .filter(
      ([, value]) =>
        typeof value !== "function" &&
        !(typeof value === "object" && value !== null && "fetch" in value),
    )
    .map(([name]) => name);

  expect(notStartable).toEqual([]);
});

test("the Worker serves sign-in at its ORIGIN, for /api there", async () => {
  const response = await entry.default.fetch(
    new Request(`${env.ORIGIN}/.well-known/oauth-authorization-server`),
    env,
    createExecutionContext(),
  );

  expect(await response.json()).toMatchObject({
    issuer: env.ORIGIN,
    protected_resources: [`${env.ORIGIN}/api`],
  });
});
