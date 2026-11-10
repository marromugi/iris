import { z } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { openDatabase } from "../../users/database";
import { type User, userWithId } from "../../users/user-store";
import { NO_USER } from "../errors";

/** What the OAuth layer hands `/api` for a signed-in user. `userId` also names their Durable Object. */
const userPropsSchema = z.object({ userId: z.string().min(1) });

export type UserProps = z.infer<typeof userPropsSchema>;

/**
 * What every route of `/api` runs with: the Worker's bindings, the signed-in user, and the
 * Durable Object that holds their agents.
 */
export type ApiEnv = {
  Bindings: Env;
  Variables: { user: User; agents: ReturnType<Env["USER_AGENT"]["getByName"]> };
};

/**
 * Finds the signed-in user from the `UserProps` the OAuth layer let the request through with,
 * and gives the routes that user and their Durable Object. Without them, or for a user that no
 * longer exists, the answer is `NO_USER`. None of the answers that pass through here is cached.
 */
export const signedInUser = createMiddleware<ApiEnv>(async (c, next) => {
  c.header("Cache-Control", "no-store");
  const props = userPropsSchema.safeParse(c.executionCtx.props);
  const user = props.success
    ? await userWithId(openDatabase(c.env.DB), props.data.userId)
    : undefined;
  if (user === undefined) {
    return c.json({ message: "Forbidden" }, NO_USER.status);
  }
  c.set("user", user);
  c.set("agents", c.env.USER_AGENT.getByName(user.id));
  return next();
});
