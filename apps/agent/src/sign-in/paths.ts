/** Where signing in happens, on the Worker's origin. */
export const SIGN_IN_PATHS = {
  /** OAuth's authorization endpoint: the sign-in page the app opens in a browser sheet. */
  authorize: "/authorize",
  /** OAuth's token endpoint, which the provider serves. */
  token: "/token",
  /** OAuth's dynamic client registration, which the provider serves. */
  register: "/register",
  /** What the sign-in page calls: a challenge for a passkey, then the passkey's answer. */
  passkeySignInOptions: "/passkey/sign-in/options",
  passkeySignIn: "/passkey/sign-in",
  /** What the sign-in page calls: an invite key for a challenge, then the new passkey. */
  passkeyRegisterOptions: "/passkey/register/options",
  passkeyRegister: "/passkey/register",
} as const;
