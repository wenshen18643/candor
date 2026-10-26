import sodium from "libsodium-wrappers-sumo";
import { combine, split } from "shamir-secret-sharing";

import { b64u, jsonBytes, padmeFrame, padmeUnframe, parseJson, toHex } from "./encoding.js";

export type CandorBox = { v: 1; alg: "xc20p-padme"; n: string; c: string };
export type SealBox = { v: 1; alg: "seal-padme"; c: string };
export type KeyPair = { publicKey: Uint8Array; privateKey: Uint8Array };
export async function ready(): Promise<void> {
  await sodium.ready;
}
export const randomKey = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));
export const generateBoxKeyPair = (): KeyPair => sodium.crypto_box_keypair();
export const generateSignKeyPair = (): KeyPair => sodium.crypto_sign_keypair();
export const keyId = (publicKey: Uint8Array): string =>
  toHex(sodium.crypto_generichash(16, publicKey, null));
export const signDetached = (message: Uint8Array, privateKey: Uint8Array): Uint8Array =>
  sodium.crypto_sign_detached(message, privateKey);
export function verifyDetached(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return sodium.crypto_sign_verify_detached(signature, message, publicKey);
  } catch {
    return false;
  }
}

export function encryptBox(key: Uint8Array, plaintext: Uint8Array, ad: Uint8Array): CandorBox {
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    padmeFrame(plaintext),
    ad,
    null,
    nonce,
    key,
  );
  return { v: 1, alg: "xc20p-padme", n: b64u.encode(nonce), c: b64u.encode(ciphertext) };
}

export function decryptBox(key: Uint8Array, box: CandorBox, ad: Uint8Array): Uint8Array {
  if (box.v !== 1 || box.alg !== "xc20p-padme") throw new Error("Unsupported box");
  return padmeUnframe(
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      b64u.decode(box.c),
      ad,
      b64u.decode(box.n),
      key,
    ),
  );
}

export const encryptJson = (key: Uint8Array, value: unknown, ad: Uint8Array): CandorBox =>
  encryptBox(key, jsonBytes(value), ad);
export const decryptJson = <T>(key: Uint8Array, box: CandorBox, ad: Uint8Array): T =>
  parseJson<T>(decryptBox(key, box, ad));
export const sealKey = (bytes: Uint8Array, recipientPk: Uint8Array): string =>
  b64u.encode(sodium.crypto_box_seal(bytes, recipientPk));
export const openSealedKey = (
  sealed: string,
  publicKey: Uint8Array,
  privateKey: Uint8Array,
): Uint8Array => sodium.crypto_box_seal_open(b64u.decode(sealed), publicKey, privateKey);
export const sealJson = (value: unknown, recipientPk: Uint8Array): SealBox => ({
  v: 1,
  alg: "seal-padme",
  c: sealKey(padmeFrame(jsonBytes(value)), recipientPk),
});
export function openSealJson<T>(box: SealBox, publicKey: Uint8Array, privateKey: Uint8Array): T {
  if (box.v !== 1 || box.alg !== "seal-padme") throw new Error("Unsupported seal");
  return parseJson<T>(padmeUnframe(openSealedKey(box.c, publicKey, privateKey)));
}

export async function splitKey(
  key: Uint8Array,
  shares: number,
  threshold: number,
): Promise<Uint8Array[]> {
  if (
    key.length !== 32 ||
    !Number.isInteger(shares) ||
    !Number.isInteger(threshold) ||
    threshold < 2 ||
    threshold > shares ||
    shares > 255
  )
    throw new Error("Invalid key sharing parameters");
  return split(key, shares, threshold);
}

export async function combineShares(shares: Uint8Array[]): Promise<Uint8Array> {
  if (
    shares.length < 2 ||
    shares.length > 255 ||
    shares.some((share) => share.length !== 33 || share[32] === 0)
  )
    throw new Error("Invalid key shares");
  return combine(shares);
}
