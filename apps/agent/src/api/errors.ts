import { z } from "@hono/zod-openapi";
import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { json } from "./schemas";

/** Every error `/api` itself answers has this body; the OAuth layer's 401 comes before `/api` and doesn't. */
export const errorSchema = z.object({ message: z.string() }).meta({ id: "Error" });

/** An error response a route documents; the route gives the description that fits it. */
export function errorResponse(description: string) {
  return json(errorSchema, description);
}

/** A request that doesn't fit the route: its schema, or a body Hono can't read as JSON. */
export const invalid = {
  400: errorResponse("The request doesn't fit the API; the message says why"),
};

/** The answer when a request reaches `/api` without a signed-in user, or for one that was removed. */
export const NO_USER = {
  status: 403,
  description: "The token names no user, or one that no longer exists",
} as const;

/** What every route can answer. The OAuth resource server answers 401 before any handler runs. */
export const signedIn = {
  401: {
    description:
      'No token, or one not valid for /api (expired, revoked, or for another resource): refresh, or sign in again. The body is empty; with a token, WWW-Authenticate says error="invalid_token" (RFC 6750).',
  },
  [NO_USER.status]: errorResponse(NO_USER.description),
  500: errorResponse("Something went wrong on the server"),
};

/**
 * Hono rejects a body it can't read (malformed JSON 400, not JSON 415) by throwing; these answer
 * as `{ message }` like every other error, and anything unexpected as 500.
 */
export const answerError: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException && error.status < 500) {
    return c.json({ message: error.message }, error.status);
  }
  console.error("/api failed.", error);
  return c.json({ message: "Something went wrong" }, 500);
};
