import { createRoute, defineOpenAPIRoute } from "@hono/zod-openapi";
import { newMailTag } from "../../../../../mail/mail";
import { openDatabase } from "../../../../../users/database";
import { setMailTag } from "../../../../../users/user-store";
import type { Answer } from "../../../../answer";
import { signedIn } from "../../../../errors";
import type { ApiEnv } from "../../../../middlewares/signed-in-user";
import { json, mailSetupSchema } from "../../../../schemas";
import { readMailSetup } from "../get";

const route = createRoute({
  operationId: "makeMailAddress",
  method: "post",
  path: "/api/me/mail/address",
  description:
    "Makes the user a new mail address. The address they had before stops taking mail, and the setup starts over; the mail already kept stays.",
  responses: {
    200: json(mailSetupSchema, "The mail setup with the new address"),
    ...signedIn,
  },
});

/** POST /api/me/mail/address: makes the signed-in user a new mail address. */
export const makeMailAddress = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    // The setup starts over first: should the new address fail to be stored, the old one still works.
    await c.var.agents.restartMail(false);
    await setMailTag(openDatabase(c.env.DB), c.var.user.id, newMailTag());
    return c.json(await readMailSetup(c), 200);
  },
});
