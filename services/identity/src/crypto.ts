import {
  constants,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  timingSafeEqual,
} from "node:crypto";

import { RSABSSA } from "@cloudflare/blindrsa-ts";

import { ServiceError } from "./models.js";

export const suite = RSABSSA.SHA384.PSS.Randomized();
const encoder = new TextEncoder();

export function encode(bytes: Uint8Array | ArrayBuffer): string {
  return Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes).toString(
    "base64url",
  );
}

export function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new ServiceError(400, "invalid_encoding");
  const bytes = new Uint8Array(Buffer.from(value, "base64url"));
  if (encode(bytes) !== value) throw new ServiceError(400, "invalid_encoding");
  return bytes;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function nullifierTag(
  secret: string,
  campaign: string,
  epoch: number,
  nullifier: string,
): string {
  return createHmac("sha256", secret).update(`${campaign}|${epoch}|${nullifier}`).digest("hex");
}

export function authorized(header: string | undefined, token: string): boolean {
  return timingSafeEqual(
    createHash("sha256")
      .update(header ?? "")
      .digest(),
    createHash("sha256").update(`Bearer ${token}`).digest(),
  );
}

async function wrappingKey(secret: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const input = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("candor/v1/identity/issuer") },
    input,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptIssuer(
  key: CryptoKey,
  secret: string,
  campaign: string,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(await crypto.subtle.exportKey("jwk", key)));
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(campaign) },
      await wrappingKey(secret, salt),
      plaintext,
    );
    return ["v1", encode(salt), encode(iv), encode(ciphertext)].join(".");
  } finally {
    plaintext.fill(0);
  }
}

export async function decryptIssuer(
  encrypted: string,
  secret: string,
  campaign: string,
): Promise<CryptoKey> {
  const [version, salt, iv, ciphertext, extra] = encrypted.split(".");
  if (version !== "v1" || !salt || !iv || !ciphertext || extra !== undefined) {
    throw new Error("invalid_key_envelope");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(iv), additionalData: encoder.encode(campaign) },
    await wrappingKey(secret, decode(salt)),
    decode(ciphertext),
  );
  try {
    const jwk: JsonWebKey = JSON.parse(new TextDecoder().decode(plaintext));
    return await crypto.subtle.importKey("jwk", jwk, { name: "RSA-PSS", hash: "SHA-384" }, true, [
      "sign",
    ]);
  } finally {
    new Uint8Array(plaintext).fill(0);
  }
}

export async function signMessages(key: CryptoKey, messages: string[]): Promise<string[]> {
  const jwk = await crypto.subtle.exportKey("jwk", key);
  if (!jwk.n) throw new Error("invalid_issuer_key");
  const modulus = Buffer.from(decode(jwk.n));
  const bytes = messages.map((message) => decode(message));
  for (const message of bytes) {
    if (
      message.length !== 256 ||
      Buffer.compare(Buffer.from(message), modulus) >= 0 ||
      message.every((byte) => byte === 0)
    ) {
      throw new ServiceError(400, "invalid_blinded_message");
    }
  }
  const privateKey = createPrivateKey({ key: jwk, format: "jwk" });
  const publicKey = createPublicKey(privateKey);
  return bytes.map((message) => {
    const signature = privateDecrypt(
      { key: privateKey, padding: constants.RSA_NO_PADDING },
      message,
    );
    const recovered = publicEncrypt(
      { key: publicKey, padding: constants.RSA_NO_PADDING },
      signature,
    );
    if (!timingSafeEqual(recovered, message)) throw new Error("signing_fault");
    return encode(signature);
  });
}
