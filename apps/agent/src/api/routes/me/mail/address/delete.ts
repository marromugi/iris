import { createRoute, defineOpenAPIRoute } from "@hono/zod-openapi";
import { openDatabase } from "../../../../../users/database";
import { setMailTag } from "../../../../../users/user-store";
import type { Answer } from "../../../../answer";
import { signedIn } from "../../../../errors";
import type { ApiEnv } from "../../../../middlewares/signed-in-user";

const route = createRoute({
  operationId: "stopMail",
  method: "delete",
  path: "/api/me/mail/address",
  description:
    "Stops the user receiving mail: their address stops taking it, the setup starts over, and the mail kept for their agents is removed.",
  responses: {
    204: { description: "Stopped, or there was nothing to stop." },
    ...signedIn,
  },
});

/** DELETE /api/me/mail/address: stops the signed-in user receiving mail. */
export const stopMail = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    await c.var.agents.restartMail(true);
    await setMailTag(openDatabase(c.env.DB), c.var.user.id, null);
    return c.body(null, 204);
  },
});
