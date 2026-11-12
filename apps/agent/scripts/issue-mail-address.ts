// Gives a user a new mail address and prints it: `pnpm --filter @iris/agent-worker mail-address
// <name>` in the local D1 that `pnpm dev` uses; with `--remote`, in the deployed one. The address
// the user had before stops working.
import { parseArgs } from "node:util";
import { mailAddressOf, newMailTag } from "../src/mail/mail";
import { userNameSchema } from "../src/users/invite";
import { giveMailTag } from "../src/users/user-store";
import { withD1 } from "./d1";

function usage(): never {
  console.error("Usage: pnpm --filter @iris/agent-worker mail-address <name> [--remote]");
  console.error("The name is the user's, as their invite gave it.");
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

const tag = newMailTag();
if (!(await withD1(remote, (db) => giveMailTag(db, name.data, tag)))) {
  console.error(`No one user is named ${name.data} in the ${remote ? "deployed" : "local"} D1.`);
  process.exit(1);
}
console.log(`Mail address for ${name.data}: ${mailAddressOf(tag)}`);
console.log("Set Gmail to forward to it; the address they had before no longer works.");
