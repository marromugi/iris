import type {
  ClientRegistrationCallbackOptions,
  ClientRegistrationCallbackResult,
} from "@cloudflare/workers-oauth-provider";

/**
 * Where the iris app receives its authorization: an RFC 8252 private-use scheme named after its
 * bundle ID. The app sends this as `OAuth.redirectURI` (apple/Packages/Modules/Sources/Backend/Auth/OAuth.swift);
 * change both together.
 */
export const APP_REDIRECT = "dev.marromugi.iris:/oauth";

/**
 * Refuses to register a client unless it is the app: a public client (no secret, so the provider
 * holds it to PKCE S256) whose only redirect URI is the app's.
 */
export function refuseAllButTheApp({
  clientMetadata,
}: ClientRegistrationCallbackOptions): ClientRegistrationCallbackResult | undefined {
  const uris = clientMetadata.redirect_uris;
  const isApp =
    clientMetadata.token_endpoint_auth_method === "none" &&
    Array.isArray(uris) &&
    uris.length > 0 &&
    uris.every((uri) => uri === APP_REDIRECT);
  return isApp
    ? undefined
    : {
        description: `iris only registers its app: a public client redirecting to ${APP_REDIRECT}`,
      };
}
