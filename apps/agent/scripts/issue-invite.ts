// Issues a one-time invite and prints its key: `pnpm --filter @iris/agent-worker invite <name>`
// stores it in the local D1 that `pnpm dev` uses; with `--remote`, in the deployed one. Only the
// key's hash is stored, so the key printed here is the only copy.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { inviteInsertStatement, newInvite, userNameSchema } from "../src/users/invite";

/** The D1 database's name in wrangler.jsonc. */
const DATABASE_NAME = "iris";

function usage(): never {
  console.error("Usage: pnpm --filter @iris/agent-worker invite <name> [--remote]");
  console.error("The name is what the user is called: 1 to 50 characters.");
  process.exit(1);
}

function parsedArguments() {
  try {
    return parseArgs({ options: { remote: { type: "boolean" } }, allowPositionals: true });
  } catch {
    return usage();
  }
}

const { values, positionals } = parsedArguments();
const remote = values.remote === true;
const name = userNameSchema.safeParse(positionals[0]);
if (positionals.length !== 1 || !name.success) {
  usage();
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
