import { reset } from "cloudflare:test";
import { afterEach, describe, expect, test } from "vitest";
import { SIGN_IN_PATHS } from "../src/sign-in/paths";
import { APP_REDIRECT } from "../src/sign-in/redirects";
import { FakeAuthenticator } from "./passkey-authenticator";
import {
  API,
  appRegistration,
  BASE,
  callApi,
  client,
  issueInvite,
  openSignInSheet,
  s256,
} from "./sign-in-client";

afterEach(async () => {
  await reset();
});

const DAY_MS = 24 * 60 * 60 * 1000;

async function me(call: (path: string, init?: RequestInit) => Promise<Response>, token: string) {
  const response = await callApi(call, token, "/me");
  return { status: response.status, body: await response.json() };
}

/** A user who made a passkey from an invite, and the passkey on their phone. */
async function newUser(name: string) {
  const phone = new FakeAuthenticator(BASE);
  const sheet = await openSignInSheet();
  const tokens = await sheet.finish(
    (await sheet.register(phone, await issueInvite(name))).body.redirectTo,
  );
  return { phone, tokens, call: sheet.call };
}

describe("a new user", () => {
  test("signs in from the app with an invite, uses /api with the token, and refreshes it", async () => {
    const key = await issueInvite("花子");
    const phone = new FakeAuthenticator(BASE);

    const sheet = await openSignInSheet();
    const registered = await sheet.register(phone, key);
    const tokens = await sheet.finish(registered.body.redirectTo);
    const [agent]: { id: string }[] = await (
      await callApi(sheet.call, tokens.access_token, "/agents")
    ).json();
    const tasks = `/agents/${agent?.id}/tasks`;
    const added = await callApi(sheet.call, tokens.access_token, tasks, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Summarize today's email",
        schedule: { cron: "0 8 * * *", timeZone: "Asia/Tokyo" },
      }),
    });
    const listed = await callApi(sheet.call, tokens.access_token, tasks);
    const refreshed = await sheet.refresh(tokens.refresh_token);

    expect(sheet.page).toContain("パスキーでサインイン");
    expect(registered.status).toBe(200);
    expect(await me(sheet.call, tokens.access_token)).toEqual({
      status: 200,
      body: { id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: "花子", canAttachImages: true },
    });
    expect(added.status).toBe(201);
    expect(await listed.json()).toEqual([await added.json()]);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.access_token).not.toBe(tokens.access_token);
    expect(await me(sheet.call, refreshed.body.access_token)).toMatchObject({
      status: 200,
      body: { name: "花子" },
    });
  });

  test("opens an agent's event socket with the token, with or without an Origin", async () => {
    const sheet = await openSignInSheet();
    const registered = await sheet.register(new FakeAuthenticator(BASE), await issueInvite("花子"));
    const tokens = await sheet.finish(registered.body.redirectTo);
    const [agent]: { id: string }[] = await (
      await callApi(sheet.call, tokens.access_token, "/agents")
    ).json();
    const events = `/agents/${agent?.id}/events`;

    const opened = await callApi(sheet.call, tokens.access_token, events, {
      headers: { Upgrade: "websocket" },
    });
    const withOrigin = await callApi(sheet.call, tokens.access_token, events, {
      headers: { Upgrade: "websocket", Origin: "https://example.com" },
    });

    for (const response of [opened, withOrigin]) {
      expect(response.status).toBe(101);
      expect(response.webSocket).not.toBeNull();
      response.webSocket?.accept();
      response.webSocket?.close();
    }
  });

  test("signs in again with their passkey alone, as the same user", async () => {
    const { phone, tokens, call } = await newUser("太郎");

    const later = await openSignInSheet();
    const signedIn = await later.signIn(phone);
    const again = await later.finish(signedIn.body.redirectTo);

    expect(signedIn.status).toBe(200);
    expect(await me(later.call, again.access_token)).toEqual(await me(call, tokens.access_token));
  });
});

describe("an invite key", () => {
  test("works once, and not after it expires or when it was never issued", async () => {
    const key = await issueInvite("次郎");
    const expired = await issueInvite("三郎", new Date(Date.now() - 8 * DAY_MS));
    await (await openSignInSheet()).register(new FakeAuthenticator(BASE), key);

    const again = await (await openSignInSheet()).requestRegistration(key.toLowerCase());
    const late = await (await openSignInSheet()).requestRegistration(expired);
    const unknown = await (await openSignInSheet()).requestRegistration("0000-0000-0000-0000-0000");

    expect(again).toEqual({
      status: 400,
      body: { message: "この鍵はもう使われています。新しい鍵をもらってください。" },
    });
    expect(late).toEqual({
      status: 400,
      body: { message: "この鍵は期限が切れています。新しい鍵をもらってください。" },
    });
    expect(unknown).toEqual({
      status: 400,
      body: { message: "この鍵は見つかりません。届いた鍵をそのまま入れてください。" },
    });
  });

  test("makes one user, even when two phones both started registering with it", async () => {
    const key = await issueInvite("七郎");
    const finishOnFirstPhone = await (
      await openSignInSheet()
    ).startRegistration(new FakeAuthenticator(BASE), key);
    const finishOnSecondPhone = await (
      await openSignInSheet()
    ).startRegistration(new FakeAuthenticator(BASE), key);

    const first = await finishOnFirstPhone();
    const second = await finishOnSecondPhone();

    expect(first.status).toBe(200);
    expect(second).toEqual({
      status: 400,
      body: { message: "この鍵はもう使われています。新しい鍵をもらってください。" },
    });
  });

  test("stays unused when the sign-in can't be finished, so the user can try again", async () => {
    const key = await issueInvite("八郎");
    const lost = await openSignInSheet();
    const finishWithoutCookies = await lost.startRegistration(new FakeAuthenticator(BASE), key);
    lost.jar.clear();

    const failed = await finishWithoutCookies();
    const retried = await (await openSignInSheet()).register(new FakeAuthenticator(BASE), key);

    expect(failed).toEqual({
      status: 400,
      body: { message: "サインインの期限が切れました。アプリからやり直してください。" },
    });
    expect(retried.status).toBe(200);
  });
});

describe("a passkey answer", () => {
  test("is refused unless their passkey made it, verified, for this sign-in on this site", async () => {
    const { phone } = await newUser("九郎");
    const refused = { status: 400, body: { message: "パスキーを確かめられませんでした。" } };

    const elsewhere = await openSignInSheet();
    const otherChallenge = await phone.get((await (await openSignInSheet()).requestSignIn()).body);
    await elsewhere.requestSignIn();
    const forOtherChallenge = await elsewhere.send(SIGN_IN_PATHS.passkeySignIn, otherChallenge);

    phone.origin = "https://evil.example";
    const fromOtherSite = await (await openSignInSheet()).signIn(phone);
    phone.origin = BASE;

    const altered = await openSignInSheet();
    const answer = await phone.get((await altered.requestSignIn()).body);
    const signature = answer.response.signature;
    answer.response.signature = signature.slice(0, -2) + (signature.endsWith("AA") ? "BB" : "AA");
    const withAlteredSignature = await altered.send(SIGN_IN_PATHS.passkeySignIn, answer);

    phone.userVerified = false;
    const unverified = await (await openSignInSheet()).signIn(phone);
    const unverifiedRegistration = await (
      await openSignInSheet()
    ).register(phone, await issueInvite("九郎の別の端末"));

    expect([
      forOtherChallenge,
      fromOtherSite,
      withAlteredSignature,
      unverified,
      unverifiedRegistration,
    ]).toEqual([refused, refused, refused, refused, refused]);
  });

  test("is refused from a passkey the server doesn't know, or when it isn't one", async () => {
    const stranger = new FakeAuthenticator(BASE);
    await stranger.create({
      rp: { id: new URL(BASE).hostname, name: "iris" },
      user: { id: "x", name: "x", displayName: "x" },
      challenge: "x",
      pubKeyCredParams: [],
    });
    const sheet = await openSignInSheet();
    await sheet.requestSignIn();

    const unknown = await (await openSignInSheet()).signIn(stranger);
    const notAnAnswer = await sheet.send(SIGN_IN_PATHS.passkeySignIn, { id: "x" });

    expect(unknown).toEqual({
      status: 400,
      body: { message: "このパスキーは登録されていません。" },
    });
    expect(notAnAnswer).toEqual({
      status: 400,
      body: { message: "送られた内容が読めませんでした。" },
    });
  });

  test("answers each challenge once, and only for what it was handed out for", async () => {
    const { phone } = await newUser("十郎");
    const tooLate = {
      status: 400,
      body: { message: "時間が経ちすぎました。もう一度試してください。" },
    };

    const replayed = await openSignInSheet();
    const answer = await phone.get((await replayed.requestSignIn()).body);
    await replayed.send(SIGN_IN_PATHS.passkeySignIn, answer);
    const again = await replayed.send(SIGN_IN_PATHS.passkeySignIn, answer);

    const mixed = await openSignInSheet();
    const signInOptions = (await mixed.requestSignIn()).body;
    const registrationForSignInChallenge = await new FakeAuthenticator(BASE).create({
      rp: { id: new URL(BASE).hostname, name: "iris" },
      user: { id: "someone", name: "someone", displayName: "someone" },
      challenge: signInOptions.challenge,
      pubKeyCredParams: [],
    });
    const asRegistration = await mixed.send(
      SIGN_IN_PATHS.passkeyRegister,
      registrationForSignInChallenge,
    );

    expect(again).toEqual(tooLate);
    expect(asRegistration).toEqual(tooLate);
  });

  test("can't register a passkey under an ID another user's passkey has", async () => {
    const first = await openSignInSheet();
    const original = await new FakeAuthenticator(BASE).create(
      (await first.requestRegistration(await issueInvite("十一郎"))).body,
    );
    await first.send(SIGN_IN_PATHS.passkeyRegister, original);
    const forgerKey = await issueInvite("偽者");
    const forger = await openSignInSheet();
    const forgedOptions = (await forger.requestRegistration(forgerKey)).body;

    const forged = await forger.send(
      SIGN_IN_PATHS.passkeyRegister,
      await new FakeAuthenticator(BASE).create(forgedOptions, original.id),
    );
    const retried = await (
      await openSignInSheet()
    ).register(new FakeAuthenticator(BASE), forgerKey);

    expect(forged).toEqual({
      status: 400,
      body: { message: "このパスキーはもう登録されています。" },
    });
    expect(retried.status).toBe(200);
  });
});

describe("the app's client", () => {
  test("is the only one that registers: a public client redirecting to the app", async () => {
    const call = client();

    const app = await call(SIGN_IN_PATHS.register, appRegistration());
    const elsewhere = await call(
      SIGN_IN_PATHS.register,
      appRegistration({
        redirect_uris: ["https://evil.example/callback"],
        token_endpoint_auth_method: "none",
      }),
    );
    const alsoElsewhere = await call(
      SIGN_IN_PATHS.register,
      appRegistration({
        redirect_uris: [APP_REDIRECT, "http://localhost:9999/callback"],
        token_endpoint_auth_method: "none",
      }),
    );
    const withSecret = await call(
      SIGN_IN_PATHS.register,
      appRegistration({ redirect_uris: [APP_REDIRECT] }),
    );

    expect(app.status).toBe(201);
    expect(await app.json()).toMatchObject({
      redirect_uris: [APP_REDIRECT],
      token_endpoint_auth_method: "none",
    });
    for (const refused of [elsewhere, alsoElsewhere, withSecret]) {
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: "invalid_client_metadata" });
    }
  });

  test("gets no sign-in page for a redirect it didn't register, or without PKCE S256", async () => {
    const call = client();
    const { client_id: clientId } = await (
      await call(SIGN_IN_PATHS.register, appRegistration())
    ).json<{ client_id: string }>();
    const authorize = async (params: Record<string, string>) =>
      call(
        `${SIGN_IN_PATHS.authorize}?${new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: APP_REDIRECT,
          state: "app-state",
          resource: API,
          ...params,
        }).toString()}`,
      );
    const challenge = await s256("verifier");

    const elsewhere = await authorize({
      redirect_uri: "https://evil.example/callback",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const withoutPkce = await authorize({});
    const plainPkce = await authorize({
      code_challenge: "verifier",
      code_challenge_method: "plain",
    });

    expect(elsewhere.status).toBe(400);
    expect(elsewhere.headers.get("Location")).toBeNull();
    for (const refused of [withoutPkce, plainPkce]) {
      const back = new URL(refused.headers.get("Location") ?? "");
      expect(refused.status).toBe(302);
      expect(`${back.protocol}${back.pathname}`).toBe(APP_REDIRECT);
      expect(back.searchParams.get("error")).toBe("invalid_request");
      expect(back.searchParams.get("code")).toBeNull();
    }
  });
});

describe("starting sign-ins", () => {
  test("answers 429 with Retry-After once one address has started 10 in a minute, and lets other addresses through", async () => {
    const busy = client("203.0.113.7");
    const other = client("203.0.113.8");

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      statuses.push((await busy(SIGN_IN_PATHS.register, appRegistration())).status);
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      statuses.push((await busy(`${SIGN_IN_PATHS.authorize}?client_id=unknown`)).status);
    }
    const limited = await busy(`${SIGN_IN_PATHS.authorize}?client_id=unknown`);

    expect(statuses).not.toContain(429);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect((await other(SIGN_IN_PATHS.register, appRegistration())).status).toBe(201);
  });

  test("counts handing out passkey challenges, and not finishing a passkey sign-in", async () => {
    const call = client("198.51.100.23");
    const post = (path: string) =>
      call(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: "h", key: "k" }),
      });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      statuses.push((await post(SIGN_IN_PATHS.passkeyRegisterOptions)).status);
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      statuses.push((await post(SIGN_IN_PATHS.passkeySignInOptions)).status);
    }
    const limited = await post(SIGN_IN_PATHS.passkeyRegisterOptions);
    const finishing = await post(SIGN_IN_PATHS.passkeySignIn);

    expect(statuses).not.toContain(429);
    expect(limited.status).toBe(429);
    expect(finishing.status).toBe(400);
  });

  test("never limits the token endpoint, so the app can always refresh", async () => {
    const call = client("203.0.113.9");

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt++) {
      const response = await call(SIGN_IN_PATHS.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: "not-a-token",
          client_id: "unknown",
        }),
      });
      statuses.push(response.status);
    }

    expect(statuses).not.toContain(429);
  });

  test("counts IPv6 addresses in one /64 network together and other networks apart", async () => {
    const first = client("2001:db8:1:2::a");
    const sameNetwork = client("2001:0db8:0001:0002:ffff:0:0:b");
    const otherNetwork = client("2001:db8:1:3::a");

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      statuses.push((await first(SIGN_IN_PATHS.register, appRegistration())).status);
    }

    expect(statuses).not.toContain(429);
    expect((await sameNetwork(SIGN_IN_PATHS.register, appRegistration())).status).toBe(429);
    expect((await otherNetwork(SIGN_IN_PATHS.register, appRegistration())).status).toBe(201);
  });
});

describe("/api", () => {
  test("answers a request without a valid token with 401 pointing to where to sign in", async () => {
    const call = client();

    const withoutToken = await call("/api/me");
    const withBadToken = await callApi(call, "not-a-token", "/me");

    expect(withoutToken.status).toBe(401);
    expect(withoutToken.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${BASE}/.well-known/oauth-protected-resource/api"`,
    );
    expect(await withoutToken.text()).toBe("");
    expect(withBadToken.status).toBe(401);
    expect(withBadToken.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
    expect(await withBadToken.text()).toBe("");
  });
});
