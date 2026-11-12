import { createRoute, defineOpenAPIRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { mailAddressOf } from "../../../../mail/mail";
import { openDatabase } from "../../../../users/database";
import { userMailTag } from "../../../../users/user-store";
import type { Answer } from "../../../answer";
import { signedIn } from "../../../errors";
import type { ApiEnv } from "../../../middlewares/signed-in-user";
import { json, type MailSetupJson, mailSetupJson, mailSetupSchema } from "../../../schemas";

const route = createRoute({
  operationId: "mailSetup",
  method: "get",
  path: "/api/me/mail",
  responses: {
    200: json(mailSetupSchema, "Where the user's mail setup stands"),
    ...signedIn,
  },
});

/** The signed-in user's mail setup: their address, and where its setup stands. */
export async function readMailSetup(c: Context<ApiEnv>): Promise<MailSetupJson> {
  const tag = await userMailTag(openDatabase(c.env.DB), c.var.user.id);
  return mailSetupJson(tag === null ? null : mailAddressOf(tag), await c.var.agents.mailState());
}

/** GET /api/me/mail: the signed-in user's mail setup. */
export const mailSetup = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => c.json(await readMailSetup(c), 200),
});
