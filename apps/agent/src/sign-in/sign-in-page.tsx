import { raw } from "hono/html";
import clientScript from "../../build/sign-in-client.txt";

// Light first, then dark. The page shows one view at a time: `data-view` on <body>, which the
// browser script switches.
const STYLE = `
:root {
  color-scheme: light dark;
  --page: #ffffff; --text: #1d1d1f; --secondary: #6e6e73; --hairline: #d2d2d7;
  --fill: #1d1d1f; --on-fill: #ffffff; --field: #f5f5f7;
  --mark: #e8f0fe; --on-mark: #1a5fd0; --link: #0a66d6;
  --danger-bg: #fdecea; --danger: #b3261e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --page: #000000; --text: #f5f5f7; --secondary: #98989d; --hairline: #38383a;
    --fill: #f5f5f7; --on-fill: #000000; --field: #1c1c1e;
    --mark: #12284a; --on-mark: #8ab4f8; --link: #64a8ff;
    --danger-bg: #3b1715; --danger: #ff8a80;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100dvh; background: var(--page); color: var(--text);
  font: 17px/1.5 -apple-system, BlinkMacSystemFont, "Hiragino Sans", system-ui, sans-serif;
  -webkit-text-size-adjust: 100%;
}
main {
  display: flex; flex-direction: column; min-height: 100dvh; max-width: 26rem; margin: 0 auto;
  padding: max(48px, env(safe-area-inset-top)) 24px max(28px, env(safe-area-inset-bottom));
}
body[data-view="sign-in"] .register-view, body[data-view="register"] .sign-in-view { display: none; }
.view { display: flex; flex-direction: column; flex: 1; }
.mark {
  width: 64px; height: 64px; margin: 24px auto 16px; border-radius: 16px;
  display: grid; place-items: center; background: var(--mark); color: var(--on-mark);
}
h1 { margin: 0; font-size: 28px; font-weight: 600; text-align: center; letter-spacing: 0.01em; }
h2 { margin: 0; font-size: 24px; font-weight: 600; }
.lead { margin: 6px 0 32px; color: var(--secondary); text-align: center; }
.hint { margin: 8px 0 20px; color: var(--secondary); font-size: 15px; }
button, input { font: inherit; width: 100%; border-radius: 14px; }
button { min-height: 50px; padding: 0 16px; cursor: pointer; }
.primary { border: 0; background: var(--fill); color: var(--on-fill); font-weight: 600; }
.secondary { border: 1px solid var(--hairline); background: transparent; color: var(--text); }
.back {
  width: auto; min-height: 44px; margin: -12px 0 12px -4px; padding: 0 4px; border: 0;
  background: none; color: var(--link); text-align: left;
}
button:disabled { opacity: 0.6; cursor: default; }
input {
  min-height: 52px; margin-bottom: 12px; padding: 0 14px; border: 1px solid var(--hairline);
  background: var(--field); color: var(--text); letter-spacing: 0.08em; text-transform: uppercase;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 16px;
}
.message:not([hidden]) + input { border-color: var(--danger); }
.message {
  margin: 0 0 12px; padding: 10px 14px; border-radius: 12px;
  background: var(--danger-bg); color: var(--danger); font-size: 15px;
}
.spacer { flex: 1; min-height: 32px; }
.first-time { padding-top: 20px; border-top: 1px solid var(--hairline); }
.first-time p { margin: 0 0 10px; color: var(--secondary); font-size: 15px; }
:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; }
`;

function Mark() {
  return (
    <div class="mark" aria-hidden="true">
      <svg
        width="34"
        height="34"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
      >
        <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="3.2" />
      </svg>
    </div>
  );
}

function SignInView() {
  return (
    <section class="view sign-in-view" aria-labelledby="sign-in-title">
      <Mark />
      <h1 id="sign-in-title">iris</h1>
      <p class="lead">パスキーでサインインします</p>
      <p id="sign-in-message" class="message" role="alert" hidden></p>
      <button id="sign-in" class="primary" type="button">
        パスキーでサインイン
      </button>
      <div class="spacer"></div>
      <div class="first-time">
        <p>はじめての方</p>
        <button id="show-register" class="secondary" type="button">
          招待の鍵で登録する
        </button>
      </div>
    </section>
  );
}

function RegisterView() {
  return (
    <section class="view register-view" aria-labelledby="register-title">
      <button id="show-sign-in" class="back" type="button">
        ‹ サインインに戻る
      </button>
      <h2 id="register-title">招待の鍵で登録</h2>
      <p class="hint">
        受け取った鍵を入れると、この端末にパスキーを作ります。鍵は 1 回だけ使えます。
      </p>
      <form id="register">
        <p id="register-message" class="message" role="alert" hidden></p>
        <input
          id="key"
          name="key"
          aria-label="招待の鍵"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck={false}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
          required
        />
        <button id="register-submit" class="primary" type="submit">
          パスキーを作る
        </button>
      </form>
    </section>
  );
}

function Page({ handle, nonce }: { handle: string; nonce: string }) {
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>iris にサインイン</title>
        <style>{raw(STYLE)}</style>
      </head>
      <body data-handle={handle} data-view="sign-in">
        <main>
          <SignInView />
          <RegisterView />
        </main>
        <script nonce={nonce}>{raw(clientScript)}</script>
      </body>
    </html>
  );
}

/**
 * The page the app opens to sign a user in: a passkey, or an invite key to make one. Its script
 * runs only with `nonce`.
 */
export function signInPage(handle: string, nonce: string): string {
  const page = <Page handle={handle} nonce={nonce} />;
  if (page instanceof Promise) {
    throw new Error("The sign-in page has an async component, so it can't render as a string.");
  }
  return `<!doctype html>${page.toString()}`;
}
