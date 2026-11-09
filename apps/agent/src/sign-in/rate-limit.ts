import { SIGN_IN_PATHS } from "./paths";

type FetchHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
};

/**
 * Paths anyone can call before signing in, each of which writes to KV or tries an invite key.
 * Finishing a passkey sign-in is not among them: it needs a challenge one of these handed out, and
 * counting it would make each sign-in cost twice as much of the limit.
 */
const LIMITED_PATHS: ReadonlySet<string> = new Set([
  SIGN_IN_PATHS.register,
  SIGN_IN_PATHS.authorize,
  SIGN_IN_PATHS.passkeySignInOptions,
  SIGN_IN_PATHS.passkeyRegisterOptions,
]);

const RETRY_AFTER_SECONDS = "60";

const IPV6_GROUPS = 8;
// One home or server connection usually gets a whole IPv6 /64, so counting by address alone would
// let it change address per request.
const IPV6_GROUPS_PER_SUBSCRIBER = 4;

/** Who a request counts against: an IPv4 address as is (also when written as IPv6), an IPv6 address by its /64 network. */
export function rateLimitKey(ip: string): string {
  if (ip.includes(".")) {
    return ip.slice(ip.lastIndexOf(":") + 1);
  }
  if (!ip.includes(":")) {
    return ip;
  }
  const [head = "", tail] = ip.toLowerCase().split("::");
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === undefined || tail === "" ? [] : tail.split(":");
  const zeros = Array<string>(IPV6_GROUPS - headGroups.length - tailGroups.length).fill("0");
  const groups = [...headGroups, ...(tail === undefined ? [] : zeros), ...tailGroups];
  return `${groups
    .slice(0, IPV6_GROUPS_PER_SUBSCRIBER)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/**
 * Puts the sign-in rate limit in front of `app`: past it, a client gets 429 on the limited paths
 * until the window passes.
 */
export function limitSignIn(app: FetchHandler): FetchHandler {
  return {
    async fetch(request, env, ctx) {
      const path = new URL(request.url).pathname;
      if (LIMITED_PATHS.has(path)) {
        const key = rateLimitKey(request.headers.get("CF-Connecting-IP") ?? "unknown");
        const { success } = await env.SIGN_IN_RATE_LIMIT.limit({ key });
        if (!success) {
          return new Response("Too many sign-in attempts; try again in a minute.", {
            status: 429,
            headers: { "Retry-After": RETRY_AFTER_SECONDS },
          });
        }
      }
      return app.fetch(request, env, ctx);
    },
  };
}
