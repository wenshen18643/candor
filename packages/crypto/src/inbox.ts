import sodium from "libsodium-wrappers-sumo";

import words from "./eff-large-wordlist.json";
import { utf8 } from "./encoding.js";
import { type KeyPair, ready } from "./envelopes.js";

export function generateCodename(count = 8): string {
  if (!Number.isInteger(count) || count < 1 || count > 128)
    throw new RangeError("Invalid word count");
  const selected: string[] = [];
  const limit = Math.floor(65536 / words.length) * words.length;
  while (selected.length < count) {
    const value = crypto.getRandomValues(new Uint16Array(1))[0]!;
    if (value < limit) selected.push(words[value % words.length]!);
  }
  return selected.join("-");
}

export const normalizeCodename = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, "-");

export async function deriveInboxKeys(codename: string): Promise<{ sign: KeyPair; box: KeyPair }> {
  await ready();
  const normalized = normalizeCodename(codename);
  if (!normalized || normalized.length > 4096) throw new Error("Invalid codename");
  const salt = sodium.crypto_generichash(16, utf8("candor/v1/inbox-salt"), null);
  const seed = sodium.crypto_pwhash(
    32,
    utf8(normalized),
    salt,
    3,
    67108864,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  const signSeed = sodium.crypto_generichash(32, utf8("sign"), seed);
  const boxSeed = sodium.crypto_generichash(32, utf8("box"), seed);
  try {
    return {
      sign: sodium.crypto_sign_seed_keypair(signSeed),
      box: sodium.crypto_box_seed_keypair(boxSeed),
    };
  } finally {
    sodium.memzero(seed);
    sodium.memzero(signSeed);
    sodium.memzero(boxSeed);
  }
}
