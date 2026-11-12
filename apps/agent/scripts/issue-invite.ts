// Issues a one-time invite and prints its key: `pnpm --filter @iris/agent-worker invite <name>`
// stores it in the local D1 that `pnpm dev` uses; with `--remote`, in the deployed one. Only the
// key's hash is stored, so the key printed here is the only copy.
import { parseArgs } from "node:util";
import { newInvite, userNameSchema } from "../src/users/invite";
import { addInvite } from "../src/users/user-store";
import { withD1 } from "./d1";

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
await withD1(remote, (db) => addInvite(db, invite));
console.log(`Invite for ${invite.name}, stored in the ${remote ? "deployed" : "local"} D1.`);
console.log(`Key: ${key}`);
console.log(`It works once, until ${invite.expiresAt.toISOString()}.`);
