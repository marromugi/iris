import {
  type ApprovedConsent,
  AuthorizationError,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { z } from "zod";
import type { UserProps } from "../api/api";
import { openDatabase } from "../users/database";
import {
  addUser,
  type InviteRefusal,
  inviteForKey,
  passkeyWithId,
  recordPasskeyUse,
  userWithId,
} from "../users/user-store";
import { SIGN_IN_PATHS } from "./paths";
import { signInPage } from "./sign-in-page";

// Long enough to read the page and use Face ID, short enough that a stale challenge is gone.
const CEREMONY_TTL_SECONDS = 300;
const CEREMONY_PREFIX = "passkey-ceremony:";

const signInCeremonySchema = z.object({ purpose: z.literal("sign-in"), challenge: z.string() });
const registerCeremonySchema = z.object({
  purpose: z.literal("register"),
  challenge: z.string(),
  inviteId: z.uuid(),
  userId: z.uuid(),
});
type Ceremony = z.infer<typeof signInCeremonySchema> | z.infer<typeof registerCeremonySchema>;

const handleSchema = z.string().min(1).max(200);

// What an answer from WebAuthn must have before the library reads it. The library checks the rest,
// and a failure there is a refusal like any other.
const answerShape = z.looseObject({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal("public-key"),
  response: z.looseObject({ clientDataJSON: z.string() }),
  clientExtensionResults: z.looseObject({}),
});
const isAnswer = (value: unknown) => answerShape.safeParse(value).success;
const signInAnswerSchema = z.custom<AuthenticationResponseJSON>(isAnswer);
const registerAnswerSchema = z.custom<RegistrationResponseJSON>(isAnswer);

const INVITE_REFUSALS: Record<InviteRefusal, string> = {
  "unknown-key": "この鍵は見つかりません。届いた鍵をそのまま入れてください。",
  "used-key": "この鍵はもう使われています。新しい鍵をもらってください。",
  "expired-key": "この鍵は期限が切れています。新しい鍵をもらってください。",
};

/** A sign-in the page can't go on with; its message is shown to the user as is. */
class Refusal extends Error {}

/** Runs a WebAuthn check, turning any failure of it into a refusal the page shows. */
async function checked<T>(check: () => Promise<T>): Promise<T> {
  try {
    return await check();
  } catch {
    throw new Refusal("パスキーを確かめられませんでした。");
  }
}

function json(body: unknown, status = 200, headers = new Headers()): Response {
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

async function startCeremony(env: Env, handle: string, ceremony: Ceremony): Promise<void> {
  await env.OAUTH_KV.put(CEREMONY_PREFIX + handle, JSON.stringify(ceremony), {
    expirationTtl: CEREMONY_TTL_SECONDS,
  });
}

/** Takes the ceremony the page started under `handle`, once, refusing one of another kind. */
async function takeCeremony<T extends Ceremony>(
  env: Env,
  handle: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const key = CEREMONY_PREFIX + handle;
  const stored = await env.OAUTH_KV.get(key);
  await env.OAUTH_KV.delete(key);
  const ceremony = stored === null ? undefined : schema.safeParse(JSON.parse(stored));
  if (!ceremony?.success) {
    throw new Refusal("時間が経ちすぎました。もう一度試してください。");
  }
  return ceremony.data;
}

/** A plain page for an authorization request that must not be sent back to the client. */
function errorPage(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}

/** One endpoint the page calls, given the JSON body it sent. */
type PasskeyRoute = (request: Request, env: Env, body: unknown) => Promise<Response>;

/** Runs a passkey endpoint: JSON in, JSON out, a refusal as `{ message }` the page shows. */
async function passkeyEndpoint(route: PasskeyRoute, request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ message: "Use POST" }, 405);
  }
  try {
    return await route(request, env, await request.json());
  } catch (error) {
    if (error instanceof Refusal) {
      return json({ message: error.message }, 400);
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return json({ message: "送られた内容が読めませんでした。" }, 400);
    }
    if (error instanceof AuthorizationError) {
      return json({ message: "サインインの期限が切れました。アプリからやり直してください。" }, 400);
    }
    throw error;
  }
}

/**
 * Signing users in to the app with passkeys. The app opens `/authorize` in a browser sheet; the
 * page made here signs in with a passkey, or makes one from an invite key, and completes the
 * authorization with the user's ID as `UserProps`. `origin` is where the Worker is served, and the
 * passkeys' relying party.
 */
export function passkeySignIn(oauthFor: (env: Env) => OAuthHelpers, origin: string) {
  const relyingParty = { origin, id: new URL(origin).hostname };

  async function complete(env: Env, approved: ApprovedConsent, userId: string): Promise<Response> {
    const user = await userWithId(openDatabase(env.DB), userId);
    if (user === undefined) {
      throw new Refusal("このパスキーは登録されていません。");
    }
    const props: UserProps = { userId };
    const { redirectTo } = await oauthFor(env).completeAuthorization({
      request: approved.request,
      userId,
      metadata: { name: user.name },
      scope: approved.request.scope,
      props,
    });
    return json({ redirectTo }, 200, approved.headers);
  }

  /** The sign-in page for an authorization request, or why there is none. */
  async function page(request: Request, env: Env): Promise<Response> {
    const oauth = oauthFor(env);
    try {
      const consent = await oauth.beginConsent(await oauth.parseAuthRequest(request));
      const nonce = crypto.randomUUID();
      const headers = consent.headers;
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.set(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
      );
      return new Response(signInPage(consent.handle, nonce), { headers });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.redirectTo === undefined
          ? errorPage(error.description)
          : Response.redirect(error.redirectTo, 302);
      }
      throw error;
    }
  }

  const passkeyRoutes: Record<string, PasskeyRoute> = {
    async [SIGN_IN_PATHS.passkeySignInOptions](_request, env, body) {
      const { handle } = z.object({ handle: handleSchema }).parse(body);
      const options = await generateAuthenticationOptions({
        rpID: relyingParty.id,
        userVerification: "required",
      });
      await startCeremony(env, handle, { purpose: "sign-in", challenge: options.challenge });
      return json(options);
    },

    async [SIGN_IN_PATHS.passkeySignIn](request, env, body) {
      const { handle, response } = z
        .object({ handle: handleSchema, response: signInAnswerSchema })
        .parse(body);
      const ceremony = await takeCeremony(env, handle, signInCeremonySchema);
      const db = openDatabase(env.DB);
      const passkey = await passkeyWithId(db, response.id);
      if (passkey === undefined) {
        throw new Refusal("このパスキーは登録されていません。");
      }
      const verification = await checked(() =>
        verifyAuthenticationResponse({
          response,
          expectedChallenge: ceremony.challenge,
          expectedOrigin: relyingParty.origin,
          expectedRPID: relyingParty.id,
          requireUserVerification: true,
          credential: {
            id: passkey.id,
            publicKey: isoBase64URL.toBuffer(passkey.publicKey),
            counter: passkey.counter,
            transports: passkey.transports,
          },
        }),
      );
      if (!verification.verified) {
        throw new Refusal("パスキーを確かめられませんでした。");
      }
      // Takes the authorization request this browser started, once, before anything is written for it.
      const approved = await oauthFor(env).approveConsent(request, handle);
      await recordPasskeyUse(
        db,
        passkey.id,
        verification.authenticationInfo.newCounter,
        new Date(),
      );
      return complete(env, approved, passkey.userId);
    },

    async [SIGN_IN_PATHS.passkeyRegisterOptions](_request, env, body) {
      const { handle, key } = z
        .object({ handle: handleSchema, key: z.string().max(100) })
        .parse(body);
      const invite = await inviteForKey(openDatabase(env.DB), key, new Date());
      if (!invite.ok) {
        throw new Refusal(INVITE_REFUSALS[invite.refusal]);
      }
      const userId = crypto.randomUUID();
      const options = await generateRegistrationOptions({
        rpName: "iris",
        rpID: relyingParty.id,
        userName: invite.value.name,
        userID: Uint8Array.from(new TextEncoder().encode(userId)),
        attestationType: "none",
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
      });
      await startCeremony(env, handle, {
        purpose: "register",
        challenge: options.challenge,
        inviteId: invite.value.id,
        userId,
      });
      return json(options);
    },

    async [SIGN_IN_PATHS.passkeyRegister](request, env, body) {
      const { handle, response } = z
        .object({ handle: handleSchema, response: registerAnswerSchema })
        .parse(body);
      const ceremony = await takeCeremony(env, handle, registerCeremonySchema);
      const verification = await checked(() =>
        verifyRegistrationResponse({
          response,
          expectedChallenge: ceremony.challenge,
          expectedOrigin: relyingParty.origin,
          expectedRPID: relyingParty.id,
          requireUserVerification: true,
        }),
      );
      if (!verification.verified) {
        throw new Refusal("パスキーを確かめられませんでした。");
      }
      // Takes the authorization request this browser started, once, before anything is written for it.
      const approved = await oauthFor(env).approveConsent(request, handle);
      const { credential } = verification.registrationInfo;
      const db = openDatabase(env.DB);
      // An unattested registration can name any credential ID, including one another user already has.
      if ((await passkeyWithId(db, credential.id)) !== undefined) {
        throw new Refusal("このパスキーはもう登録されています。");
      }
      const added = await addUser(
        db,
        {
          inviteId: ceremony.inviteId,
          userId: ceremony.userId,
          passkey: {
            id: credential.id,
            publicKey: isoBase64URL.fromBuffer(credential.publicKey),
            counter: credential.counter,
            transports: credential.transports ?? [],
          },
        },
        new Date(),
      );
      if (!added.ok) {
        throw new Refusal(INVITE_REFUSALS[added.refusal]);
      }
      return complete(env, approved, added.value.id);
    },
  };

  return {
    /** Whether `path` is the sign-in page or one of the passkey endpoints it calls. */
    handles(path: string): boolean {
      return path === SIGN_IN_PATHS.authorize || Object.hasOwn(passkeyRoutes, path);
    },

    async fetch(request: Request, env: Env): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (path === SIGN_IN_PATHS.authorize) {
        return request.method === "GET"
          ? page(request, env)
          : new Response("Use GET", { status: 405, headers: { Allow: "GET" } });
      }
      const route = passkeyRoutes[path];
      return route === undefined
        ? json({ message: "Not found" }, 404)
        : passkeyEndpoint(route, request, env);
    },
  };
}
