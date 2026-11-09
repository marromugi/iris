// Issues a one-time invite and prints its key: `pnpm --filter @iris/agent-worker invite <name>`
// stores it in the local D1 that `pnpm dev` uses; with `--remote` after the name, in the deployed
// one. Only the key's hash is stored, so the key printed here is the only copy.
import { execFileSync } from "node:child_process";
import { inviteInsertStatement, newInvite, userNameSchema } from "../src/users/invite";

/** The D1 database's name in wrangler.jsonc. */
const DATABASE_NAME = "iris";

const [typedName, ...rest] = process.argv.slice(2);
const remote = rest.length === 1 && rest[0] === "--remote";
const name = userNameSchema.safeParse(typedName);
if (!name.success || (rest.length > 0 && !remote)) {
  console.error("Usage: pnpm --filter @iris/agent-worker invite <name> [--remote]");
  console.error("The name is what the user is called: 1 to 50 characters.");
  process.exit(1);
}

const { key, invite } = await newInvite(name.data, new Date());
execFileSync(
  "wrangler",
  [
    "d1",
    "execute",
    DATABASE_NAME,
    remote ? "--remote" : "--local",
    "--command",
    inviteInsertStatement(invite),
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);
console.log(`Invite for ${invite.name}, stored in the ${remote ? "deployed" : "local"} D1.`);
console.log(`Key: ${key}`);
console.log(`It works once, until ${invite.expiresAt.toISOString()}.`);
