import { z } from "@hono/zod-openapi";
import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { json } from "./schemas";

/** Every error with a body answers this. */
export const errorSchema = z.object({ message: z.string() }).meta({ id: "Error" });

/** An error response a route documents; the route gives the description that fits it. */
export function errorResponse(description: string) {
  return json(errorSchema, description);
}

/** A request that doesn't fit the route: its schema, or a body Hono can't read as JSON. */
export const invalid = {
  400: errorResponse("The request doesn't fit the API; the message says why"),
};

/** What every route can answer. The OAuth resource server answers 401 before any handler runs. */
export const signedIn = {
  401: {
    description:
      "No token, or one not valid for /api (expired, revoked, or for another resource): sign in again. The body is empty without a token, and { error, error_description } (RFC 6750) with one.",
  },
  403: errorResponse("The token names no user"),
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
