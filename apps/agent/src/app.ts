import { OAuthAuthorizationServer, OAuthResourceServer } from "@cloudflare/workers-oauth-provider";
import { agentApi, type UserProps } from "./api/api";
import { passkeySignIn } from "./sign-in/passkey-sign-in";
import { SIGN_IN_PATHS } from "./sign-in/paths";
import { limitSignIn } from "./sign-in/rate-limit";
import { refuseAllButTheApp } from "./sign-in/redirects";

const API_PATH = "/api";

/** Whether `path` is the resource's own path or one under it. */
function isUnder(path: string, resourcePath: string): boolean {
  return path === resourcePath || path.startsWith(`${resourcePath}/`);
}

/**
 * The Worker served at `origin`: an OAuth authorization server, and `/api` as the one resource it
 * issues tokens for. Users sign in from the app with passkeys; a token for `/api` reaches it with
 * the user's `UserProps`. Starting a sign-in is limited per IP.
 */
export function createApp(origin: string) {
  const issuer = new URL(origin).origin;
  const resource = new URL(API_PATH, issuer).href;
  const authorizationServer = new OAuthAuthorizationServer<Env>({
    issuer,
    resources: [resource],
    authorizeEndpoint: SIGN_IN_PATHS.authorize,
    tokenEndpoint: SIGN_IN_PATHS.token,
    clientRegistrationEndpoint: SIGN_IN_PATHS.register,
    clientRegistrationCallback: refuseAllButTheApp,
    allowPrivateUseRedirectUris: true,
  });
  const api = new OAuthResourceServer<Env, UserProps>({
    resourceMetadata: { resource, resource_name: "iris", authorization_servers: [issuer] },
    validateToken: (env) => (audience, token) =>
      authorizationServer.validateToken(audience, token, env),
    handler: agentApi,
  });
  const signIn = passkeySignIn((env) => authorizationServer.getOAuthApi(env), issuer);

  return limitSignIn({
    fetch(request, env, ctx) {
      const path = new URL(request.url).pathname;
      if (isUnder(path, API_PATH) || path === `/.well-known/oauth-protected-resource${API_PATH}`) {
        return api.fetch(request, env, ctx);
      }
      if (signIn.handles(path)) {
        return signIn.fetch(request, env);
      }
      return authorizationServer.fetch(request, env, ctx);
    },
  });
}
