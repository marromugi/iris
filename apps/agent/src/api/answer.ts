import type { RouteConfig, RouteConfigToTypedResponse } from "@hono/zod-openapi";
import type { TypedResponse } from "hono";
import type { StatusCode } from "hono/utils/http-status";

/**
 * What a route's handler may answer: exactly the statuses and bodies its `responses` document,
 * with a documented response that has no body (a 204) answered by `c.body(null, status)`.
 *
 * Handlers declare this as their return type. Left to infer, a route that documents any response
 * without a body (every route documents the OAuth layer's 401) lets its handler return any
 * `Response`, and an undocumented status or body would still compile.
 */
export type Answer<R extends RouteConfig> = Response &
  (
    | RouteConfigToTypedResponse<R>
    | {
        [Status in keyof R["responses"]]: R["responses"][Status] extends { content: unknown }
          ? never
          : TypedResponse<null, Status & StatusCode, "body">;
      }[keyof R["responses"]]
  );
