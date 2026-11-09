// Runs in the browser sheet the app opens. Bundled by `pnpm build:client` and inlined into the
// sign-in page; it signs in with a passkey, or makes one with an invite key, and then follows the
// redirect the server answers with, which returns to the app.
import {
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { SIGN_IN_PATHS } from "../paths";

const BUSY_LABEL = "確かめています…";
const TOO_MANY_TRIES = "試した回数が多すぎます。1 分ほど待ってからやり直してください。";
const CANCELLED = "パスキーの操作が取り消されました。";
const FAILED = "うまくいきませんでした。もう一度試してください。";

/** A refusal the server explained; its message is shown as it is. */
class Refusal extends Error {}

function element<T extends HTMLElement>(id: string, kind: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof kind)) {
    throw new Error(`The sign-in page has no #${id} that is a ${kind.name}.`);
  }
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRequestOptions(value: unknown): value is PublicKeyCredentialRequestOptionsJSON {
  return isRecord(value) && typeof value.challenge === "string";
}

function isCreationOptions(value: unknown): value is PublicKeyCredentialCreationOptionsJSON {
  return isRecord(value) && typeof value.challenge === "string" && isRecord(value.user);
}

async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle: document.body.dataset.handle, ...body }),
  });
  if (response.status === 429) {
    throw new Refusal(TOO_MANY_TRIES);
  }
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Refusal(isRecord(json) && typeof json.message === "string" ? json.message : FAILED);
  }
  return json;
}

function redirectOf(json: unknown): string {
  if (!isRecord(json) || typeof json.redirectTo !== "string") {
    throw new Error("The server finished signing in without saying where to go next.");
  }
  return json.redirectTo;
}

function messageFor(error: unknown): string {
  if (error instanceof Refusal) {
    return error.message;
  }
  if (error instanceof Error && error.name === "NotAllowedError") {
    return CANCELLED;
  }
  console.error("Signing in failed.", error);
  return FAILED;
}

/**
 * Runs one sign-in step from `button`: shows it busy, and either follows the redirect the step
 * answers with (staying busy while the app takes over) or shows why it failed in `message`.
 */
async function run(button: HTMLButtonElement, message: HTMLElement, step: () => Promise<string>) {
  const label = button.textContent;
  message.hidden = true;
  button.disabled = true;
  button.textContent = BUSY_LABEL;
  try {
    location.assign(await step());
  } catch (error) {
    message.textContent = messageFor(error);
    message.hidden = false;
    button.disabled = false;
    button.textContent = label;
  }
}

function show(view: "sign-in" | "register", focus: HTMLElement) {
  document.body.dataset.view = view;
  focus.focus();
}

const signInButton = element("sign-in", HTMLButtonElement);
const signInMessage = element("sign-in-message", HTMLElement);
const registerForm = element("register", HTMLFormElement);
const registerButton = element("register-submit", HTMLButtonElement);
const registerMessage = element("register-message", HTMLElement);
const keyInput = element("key", HTMLInputElement);

element("show-register", HTMLButtonElement).addEventListener("click", () => {
  show("register", keyInput);
});
element("show-sign-in", HTMLButtonElement).addEventListener("click", () => {
  show("sign-in", signInButton);
});

signInButton.addEventListener("click", () => {
  void run(signInButton, signInMessage, async () => {
    const options = await post(SIGN_IN_PATHS.passkeySignInOptions, {});
    if (!isRequestOptions(options)) {
      throw new Error("The server answered a sign-in challenge without one.");
    }
    const response = await startAuthentication({ optionsJSON: options });
    return redirectOf(await post(SIGN_IN_PATHS.passkeySignIn, { response }));
  });
});

registerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void run(registerButton, registerMessage, async () => {
    const options = await post(SIGN_IN_PATHS.passkeyRegisterOptions, {
      key: keyInput.value.trim(),
    });
    if (!isCreationOptions(options)) {
      throw new Error("The server answered a registration challenge without one.");
    }
    const response = await startRegistration({ optionsJSON: options });
    return redirectOf(await post(SIGN_IN_PATHS.passkeyRegister, { response }));
  });
});
