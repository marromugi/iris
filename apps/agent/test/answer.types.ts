// Compiled by `pnpm typecheck`, not run: each `@ts-expect-error` fails the build if a handler could
// answer something its route doesn't document, which is what `Answer` is for.
import type { TypedResponse } from "hono";
import type { Answer } from "../src/api/answer";
import type { removeTask } from "../src/api/routes/tasks/[taskId]/delete";
import type { listTasks } from "../src/api/routes/tasks/get";

type ListTasksAnswer = Answer<typeof listTasks.route>;
type RemoveTaskAnswer = Answer<typeof removeTask.route>;

declare const teapot: Response & TypedResponse<{ message: string }, 418, "json">;
declare const wrongBody: Response & TypedResponse<{ nope: number }, 200, "json">;
declare const noContent: Response & TypedResponse<null, 204, "body">;
declare const notFound: Response & TypedResponse<{ message: string }, 404, "json">;

// @ts-expect-error a status the route doesn't document
export const undocumentedStatus: ListTasksAnswer = teapot;
// @ts-expect-error a body the route doesn't document for 200
export const undocumentedBody: ListTasksAnswer = wrongBody;
// @ts-expect-error a 204 on a route that doesn't document one
export const undocumentedNoContent: ListTasksAnswer = noContent;

export const documentedNoContent: RemoveTaskAnswer = noContent;
export const documentedNotFound: RemoveTaskAnswer = notFound;
