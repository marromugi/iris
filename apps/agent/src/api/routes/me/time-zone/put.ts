import { createRoute, defineOpenAPIRoute, z } from "@hono/zod-openapi";
import { DAY_STARTS_AT_HOUR, DEFAULT_TIME_ZONE } from "../../../../day";
import { timeZoneSchema } from "../../../../schedule";
import type { Answer } from "../../../answer";
import { errorResponse, invalid, signedIn } from "../../../errors";
import type { ApiEnv } from "../../../middlewares/signed-in-user";

const timeZoneBodySchema = z
  .object({
    timeZone: timeZoneSchema.meta({
      description: "An IANA time zone such as Asia/Tokyo, as the device is set to",
    }),
  })
  .meta({ id: "TimeZone" });

const route = createRoute({
  operationId: "setTimeZone",
  method: "put",
  path: "/api/me/time-zone",
  description: `Sets the time zone the user's days are read in. A day ends at ${DAY_STARTS_AT_HOUR}:00 in it, when each thread's summary of the day is written. Until the app sets one, it is ${DEFAULT_TIME_ZONE}.`,
  request: {
    body: { content: { "application/json": { schema: timeZoneBodySchema } }, required: true },
  },
  responses: {
    204: { description: "Set." },
    415: errorResponse("The body isn't sent as application/json"),
    ...invalid,
    ...signedIn,
  },
});

/** PUT /api/me/time-zone: sets the signed-in user's time zone, from their device. */
export const setTimeZone = defineOpenAPIRoute<typeof route, ApiEnv>({
  route,
  handler: async (c): Promise<Answer<typeof route>> => {
    const set = await c.var.agents.setTimeZone(c.req.valid("json").timeZone);
    return set.ok ? c.body(null, 204) : c.json({ message: set.error }, 400);
  },
});
