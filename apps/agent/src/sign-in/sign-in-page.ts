import { SIGN_IN_PATHS } from "./paths";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

// Runs in the browser sheet the app opens. It turns the server's JSON options into what WebAuthn
// takes, sends the result back, and follows the redirect the server answers with, which returns to
// the app.
const SCRIPT = `
const paths = ${JSON.stringify(SIGN_IN_PATHS)};
const handle = document.body.dataset.handle;
const message = document.getElementById("message");
const toBytes = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const toText = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
const post = async (path, body) => {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle, ...body }) });
  if (response.status === 429) throw new Error("試した回数が多すぎます。1 分ほど待ってからやり直してください。");
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.message || "うまくいきませんでした。もう一度試してください。");
  return json;
};
const credentialJson = (credential) => ({
  id: credential.id,
  rawId: toText(credential.rawId),
  type: credential.type,
  authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
  clientExtensionResults: credential.getClientExtensionResults(),
  response: Object.fromEntries(
    ["clientDataJSON", "attestationObject", "authenticatorData", "signature", "userHandle"]
      .filter((name) => credential.response[name])
      .map((name) => [name, toText(credential.response[name])])
      .concat(credential.response.getTransports ? [["transports", credential.response.getTransports()]] : []),
  ),
});
const run = async (work) => {
  message.textContent = "";
  try {
    location.href = (await work()).redirectTo;
  } catch (error) {
    message.textContent = error.name === "NotAllowedError" ? "パスキーの操作が取り消されました。" : error.message;
  }
};
document.getElementById("sign-in").addEventListener("click", () => run(async () => {
  const options = await post(paths.passkeySignInOptions, {});
  options.challenge = toBytes(options.challenge);
  options.allowCredentials = (options.allowCredentials ?? []).map((c) => ({ ...c, id: toBytes(c.id) }));
  const credential = await navigator.credentials.get({ publicKey: options });
  return post(paths.passkeySignIn, { response: credentialJson(credential) });
}));
document.getElementById("register").addEventListener("submit", (event) => {
  event.preventDefault();
  const key = document.getElementById("key").value;
  run(async () => {
    const options = await post(paths.passkeyRegisterOptions, { key });
    options.challenge = toBytes(options.challenge);
    options.user.id = toBytes(options.user.id);
    options.excludeCredentials = (options.excludeCredentials ?? []).map((c) => ({ ...c, id: toBytes(c.id) }));
    const credential = await navigator.credentials.create({ publicKey: options });
    return post(paths.passkeyRegister, { response: credentialJson(credential) });
  });
});
`;

/** The page the app opens to sign a user in: a passkey, or an invite key to make one. Its script runs only with `nonce`. */
export function signInPage(handle: string, nonce: string): string {
  return `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>iris にサインイン</title>
<style>
  body { font: 17px -apple-system, system-ui, sans-serif; margin: 0 auto; max-width: 28rem; padding: 24px 20px; color: #1d1d1f; }
  h1 { font-size: 24px; }
  h2 { font-size: 17px; margin-top: 40px; }
  button, input { box-sizing: border-box; width: 100%; font: inherit; padding: 14px; border-radius: 12px; }
  button { border: 0; background: #1d1d1f; color: #fff; }
  input { border: 1px solid #c7c7cc; margin-bottom: 12px; letter-spacing: 0.08em; text-transform: uppercase; }
  #message { color: #c00; min-height: 1.5em; }
  @media (prefers-color-scheme: dark) {
    body { background: #000; color: #f5f5f7; }
    button { background: #f5f5f7; color: #000; }
    input { background: #1c1c1e; color: #f5f5f7; border-color: #3a3a3c; }
    #message { color: #ff6961; }
  }
</style>
<body data-handle="${escapeHtml(handle)}">
<h1>iris にサインイン</h1>
<p id="message" role="alert"></p>
<button id="sign-in" type="button">パスキーでサインイン</button>
<h2>はじめての方</h2>
<p>受け取った招待の鍵を入れると、この端末にパスキーを作って登録します。鍵は 1 回だけ使えます。</p>
<form id="register">
  <input id="key" name="key" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" required>
  <button type="submit">パスキーを作って登録</button>
</form>
<script nonce="${escapeHtml(nonce)}">${SCRIPT}</script>
</body>
</html>`;
}
