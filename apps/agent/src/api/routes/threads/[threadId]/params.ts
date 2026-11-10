import { z } from "@hono/zod-openapi";
import { errorResponse } from "../../../errors";

/** The path of one of the user's threads. */
export const threadParams = z.object({ threadId: z.uuid() });

export const NO_SUCH_THREAD = "No thread of this user has this ID";

/** What a route under one thread answers when the user has no thread with its ID. */
export const noSuchThread = { 404: errorResponse(NO_SUCH_THREAD) };
