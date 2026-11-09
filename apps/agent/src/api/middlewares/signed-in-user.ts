import { z } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { NO_USER } from "../errors";

/** What the OAuth layer hands `/api` for a signed-in user. `userId` also names their Durable Object. */
const userPropsSchema = z.object({ userId: z.string().min(1) });

export type UserProps = z.infer<typeof userPropsSchema>;

/** What every route of `/api` runs with: the Worker's bindings and the signed-in user's agent. */
export type ApiEnv = {
  Bindings: Env;
  Variables: { agent: ReturnType<Env["USER_AGENT"]["getByName"]> };
};

/**
 * Finds the signed-in user from the `UserProps` the OAuth layer let the request through with,
 * and gives the routes that user's Durable Object. Without them the answer is `NO_USER`. None of
 * the answers that pass through here is cached.
 */
export const signedInUser = createMiddleware<ApiEnv>(async (c, next) => {
  c.header("Cache-Control", "no-store");
  const props = userPropsSchema.safeParse(c.executionCtx.props);
  if (!props.success) {
    return c.json({ message: "Forbidden" }, NO_USER.status);
  }
  c.set("agent", c.env.USER_AGENT.getByName(props.data.userId));
  return next();
});
