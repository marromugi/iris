import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { expect } from "vitest";
import { createApp } from "../src/app";
import { SIGN_IN_PATHS } from "../src/sign-in/paths";
import { APP_REDIRECT } from "../src/sign-in/redirects";
import { openDatabase } from "../src/users/database";
import { newInvite } from "../src/users/invite";
import { addInvite } from "../src/users/user-store";
import type { FakeAuthenticator } from "./passkey-authenticator";

// Driving the Worker as the iris app does: registering itself, opening the sign-in sheet,
// exchanging codes, refreshing tokens, and calling /api.

export const BASE = env.ORIGIN;
export const API = `${BASE}/api`;

export type Call = (path: string, init?: RequestInit) => Promise<Response>;

/** Sends requests to the Worker from one IP address, so each client has its own sign-in rate limit. */
export function client(ip: string = crypto.randomUUID()): Call {
  const app = createApp(env.ORIGIN);
  return async (path, init) => {
    const ctx = createExecutionContext();
    const headers = new Headers(init?.headers);
    headers.set("CF-Connecting-IP", ip);
    const response = await app.fetch(
      new Request(BASE + path, { redirect: "manual", ...init, headers }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return response;
  };
}

/** Cookies set by one response, sent back on the next, as a browser would. */
export class CookieJar {
  private cookies = new Map<string, string>();

  take(response: Response): void {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = ""] = cookie.split(";");
      const [name = "", value = ""] = pair.split("=");
      this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  /** Drops every cookie, as a browser that refused or lost them would. */
  clear(): void {
    this.cookies.clear();
  }
}

export async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** Issues an invite as the invite command does, into the test D1, and returns its key. */
export async function issueInvite(name: string, now = new Date()): Promise<string> {
  const { key, invite } = await newInvite(name, now);
  await addInvite(openDatabase(env.DB), invite);
  return key;
}

/** The app's registration request, as it sends it. */
export function appRegistration(
  metadata: Record<string, unknown> = {
    client_name: "iris",
    redirect_uris: [APP_REDIRECT],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
  },
): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  };
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
}

/** What a passkey endpoint answers: the next step's options, where to go once signed in, or why not. */
export type Reply<T = { redirectTo?: string; message?: string }> = { status: number; body: T };

/** Calls `/api` with an access token. */
export async function callApi(call: Call, token: string, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return call(`/api${path}`, { ...init, headers });
}

/**
 * The app opening the sign-in sheet: it registers itself, opens /authorize with PKCE for /api, and
 * the sheet holds the page's cookies. Returns what the page can do, and the app's steps after it.
 */
export async function openSignInSheet(call: Call = client()) {
  const jar = new CookieJar();
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const registered = await call(SIGN_IN_PATHS.register, appRegistration());
  const { client_id: clientId } = await registered.json<{ client_id: string }>();
  const sheet = await call(
    `${SIGN_IN_PATHS.authorize}?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: APP_REDIRECT,
      code_challenge: await s256(verifier),
      code_challenge_method: "S256",
      state: "app-state",
      resource: API,
    }).toString()}`,
  );
  jar.take(sheet);
  const page = await sheet.text();
  const handle = /data-handle="([^"]+)"/.exec(page)?.[1] ?? "";

  async function post<T = Reply["body"]>(path: string, body: object): Promise<Reply<T>> {
    const response = await call(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: jar.header() },
      body: JSON.stringify({ handle, ...body }),
    });
    jar.take(response);
    return { status: response.status, body: await response.json<T>() };
  }

  async function token(grant: Record<string, string>): Promise<Reply<Tokens>> {
    const response = await call(SIGN_IN_PATHS.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, resource: API, ...grant }),
    });
    return { status: response.status, body: await response.json<Tokens>() };
  }

  // A refused request for options answers `{ message }` instead.
  const requestRegistration = (key: string) =>
    post<PublicKeyCredentialCreationOptionsJSON & { message?: string }>(
      SIGN_IN_PATHS.passkeyRegisterOptions,
      { key },
    );
  const requestSignIn = () =>
    post<PublicKeyCredentialRequestOptionsJSON & { message?: string }>(
      SIGN_IN_PATHS.passkeySignInOptions,
      {},
    );

  return {
    call,
    jar,
    page,
    sheet,
    requestRegistration,
    requestSignIn,
    /** Makes a passkey from an invite key, as the page's form does. */
    async register(authenticator: FakeAuthenticator, key: string): Promise<Reply> {
      const options = await requestRegistration(key);
      if (options.status !== 200) {
        return options;
      }
      return post(SIGN_IN_PATHS.passkeyRegister, {
        response: await authenticator.create(options.body),
      });
    },
    /** The two halves of `register`, for running two sheets side by side. */
    async startRegistration(authenticator: FakeAuthenticator, key: string) {
      const response = await authenticator.create((await requestRegistration(key)).body);
      return () => post(SIGN_IN_PATHS.passkeyRegister, { response });
    },
    /** Signs in with a passkey the authenticator holds, as the page's button does. */
    async signIn(authenticator: FakeAuthenticator): Promise<Reply> {
      const options = await requestSignIn();
      return post(SIGN_IN_PATHS.passkeySignIn, {
        response: await authenticator.get(options.body),
      });
    },
    /** Sends an answer as is, for answers made elsewhere or changed on the way. */
    send(path: string, response: unknown): Promise<Reply> {
      return post(path, { response });
    },
    /** The app taking the redirect back from the sheet and exchanging its code for tokens. */
    async finish(redirectTo: string | undefined): Promise<Tokens> {
      const back = new URL(redirectTo ?? "");
      expect(`${back.protocol}${back.pathname}`).toBe(APP_REDIRECT);
      expect(back.searchParams.get("state")).toBe("app-state");
      const tokens = await token({
        grant_type: "authorization_code",
        code: back.searchParams.get("code") ?? "",
        redirect_uri: APP_REDIRECT,
        code_verifier: verifier,
      });
      expect(tokens.status).toBe(200);
      return tokens.body;
    },
    /** The app refreshing its tokens. */
    refresh(refreshToken: string): Promise<Reply<Tokens>> {
      return token({ grant_type: "refresh_token", refresh_token: refreshToken });
    },
  };
}
