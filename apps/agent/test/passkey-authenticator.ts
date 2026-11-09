import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

// Stands in for a phone's passkey store: makes ES256 passkeys and signs with them as WebAuthn does,
// at `origin`.

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL = 0x40;

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function bigEndian(value: number, bytes: number): Uint8Array {
  return Uint8Array.from({ length: bytes }, (_, i) => (value >>> (8 * (bytes - 1 - i))) & 0xff);
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

const utf8 = (text: string) => Uint8Array.from(new TextEncoder().encode(text));

/** An ECDSA signature as WebAuthn sends it: DER, not WebCrypto's raw r‖s. */
function der(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array) => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) {
      start++;
    }
    const trimmed = bytes.slice(start);
    const value = (trimmed[0] ?? 0) & 0x80 ? concat(Uint8Array.of(0), trimmed) : trimmed;
    return concat(Uint8Array.of(0x02, value.length), value);
  };
  const r = integer(raw.slice(0, 32));
  const s = integer(raw.slice(32));
  return concat(Uint8Array.of(0x30, r.length + s.length), r, s);
}

interface Passkey {
  privateKey: CryptoKey;
  rpId: string;
  userHandle: string;
  counter: number;
}

export class FakeAuthenticator {
  private passkeys = new Map<string, Passkey>();

  /** Whether it reports that the person was verified (Face ID and the like), as a real phone does. */
  userVerified = true;

  /** `origin` is the page it believes it is answering, as a browser reports it. */
  constructor(public origin: string) {}

  private flags(): number {
    return FLAG_USER_PRESENT | (this.userVerified ? FLAG_USER_VERIFIED : 0);
  }

  /**
   * Makes a passkey for the options the server gave, as `navigator.credentials.create` would.
   * `reusedId` makes it claim a credential ID it did not make, as a forged registration can.
   */
  async create(
    options: PublicKeyCredentialCreationOptionsJSON,
    reusedId?: string,
  ): Promise<RegistrationResponseJSON> {
    const rpId = options.rp.id ?? new URL(this.origin).hostname;
    const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    if (!("privateKey" in keyPair)) {
      throw new Error("ECDSA makes a key pair.");
    }
    const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    if (jwk instanceof ArrayBuffer) {
      throw new Error("A key exported as JWK is a JsonWebKey.");
    }
    const credentialId =
      reusedId === undefined
        ? crypto.getRandomValues(new Uint8Array(16))
        : isoBase64URL.toBuffer(reusedId);
    const id = isoBase64URL.fromBuffer(credentialId);
    const publicKey = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, isoBase64URL.toBuffer(jwk.x ?? "")],
        [-3, isoBase64URL.toBuffer(jwk.y ?? "")],
      ]),
    );
    const authenticatorData = concat(
      await sha256(utf8(rpId)),
      Uint8Array.of(this.flags() | FLAG_ATTESTED_CREDENTIAL),
      bigEndian(0, 4),
      new Uint8Array(16),
      bigEndian(credentialId.length, 2),
      credentialId,
      publicKey,
    );
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<never, never>>([
        ["fmt", "none"],
        ["attStmt", new Map<never, never>()],
        ["authData", authenticatorData],
      ]),
    );
    const clientData = utf8(
      JSON.stringify({
        type: "webauthn.create",
        challenge: options.challenge,
        origin: this.origin,
        crossOrigin: false,
      }),
    );
    this.passkeys.set(id, {
      privateKey: keyPair.privateKey,
      rpId,
      userHandle: options.user.id,
      counter: 0,
    });
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientData),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  /** Signs the server's challenge with a passkey it holds, as `navigator.credentials.get` would. */
  async get(
    options: PublicKeyCredentialRequestOptionsJSON,
    credentialId?: string,
  ): Promise<AuthenticationResponseJSON> {
    const id = credentialId ?? [...this.passkeys.keys()][0];
    const passkey = id === undefined ? undefined : this.passkeys.get(id);
    if (id === undefined || passkey === undefined) {
      throw new Error("The fake authenticator holds no such passkey.");
    }
    passkey.counter += 1;
    const authenticatorData = concat(
      await sha256(utf8(options.rpId ?? passkey.rpId)),
      Uint8Array.of(this.flags()),
      bigEndian(passkey.counter, 4),
    );
    const clientData = utf8(
      JSON.stringify({
        type: "webauthn.get",
        challenge: options.challenge,
        origin: this.origin,
        crossOrigin: false,
      }),
    );
    const signed = concat(authenticatorData, await sha256(clientData));
    const raw = new Uint8Array(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, passkey.privateKey, signed),
    );
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientData),
        authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
        signature: isoBase64URL.fromBuffer(Uint8Array.from(der(raw))),
        userHandle: passkey.userHandle,
      },
      clientExtensionResults: {},
    };
  }
}
