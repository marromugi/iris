import { createRoute, defineOpenAPIRoute } from "@hono/zod-openapi";
import type { Answer } from "../../../../answer";
import { signedIn } from "../../../../errors";
import type { ApiEnv } from "../../../../middlewares/signed-in-user";

const route = createRoute({
  operationId: "dismissMailConfirmation",
  method: "delete",
  path: "/api/me/mail/confirmation",
  description:
    "Lets go of Gmail's forwarding confirmation, as once the user has opened it, so the app stops offering it.",
  responses: {
    204: { description: "Let go, or there was none." },
    ...signedIn,
  },
});

/** DELETE /api/me/mail/confirmation: lets go of the signed-in user's Gmail forwarding confirmation. */
export const dismissMailConfirmation = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    await c.var.agents.dismissMailConfirmation();
    return c.body(null, 204);
  },
});
