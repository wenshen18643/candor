import { RSABSSA } from "@cloudflare/blindrsa-ts";

import { b64u, toHex } from "./encoding.js";
import { randomKey } from "./envelopes.js";
import { sha256 } from "./merkle.js";

export type BlindToken = { key_id: string; prepared: string; signature: string };
const suite = RSABSSA.SHA384.PSS.Randomized();

async function importIssuer(spki: string): Promise<CryptoKey> {
  const key = await crypto.subtle.importKey(
    "spki",
    new Uint8Array(b64u.decode(spki)),
    { name: "RSA-PSS", hash: "SHA-384" },
    true,
    ["verify"],
  );
  const algorithm = key.algorithm as RsaHashedKeyAlgorithm;
  if (algorithm.modulusLength !== 2048 || toHex(algorithm.publicExponent) !== "010001")
    throw new Error("Invalid issuer parameters");
  return key;
}

export async function prepareBlindTokens(
  issuerSpkiB64u: string,
  keyId: string,
  count: number,
): Promise<{
  blindedMessages: string[];
  finalize(blindSignatures: string[]): Promise<BlindToken[]>;
}> {
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("Invalid token count");
  if (keyId !== toHex(sha256(b64u.decode(issuerSpkiB64u))).slice(0, 16))
    throw new Error("Issuer key ID mismatch");
  const key = await importIssuer(issuerSpkiB64u);
  const states = await Promise.all(
    Array.from({ length: count }, async () => {
      const prepared = suite.prepare(randomKey());
      return { prepared, ...(await suite.blind(key, prepared)) };
    }),
  );
  let finalized = false;
  return {
    blindedMessages: states.map((state) => b64u.encode(state.blindedMsg)),
    async finalize(signatures) {
      if (finalized || signatures.length !== states.length)
        throw new Error("Invalid issuance state");
      finalized = true;
      try {
        const results = await Promise.allSettled(
          states.map(async (state, index) => ({
            key_id: keyId,
            prepared: b64u.encode(state.prepared),
            signature: b64u.encode(
              await suite.finalize(key, state.prepared, b64u.decode(signatures[index]!), state.inv),
            ),
          })),
        );
        if (results.some((result) => result.status === "rejected"))
          throw new Error("Invalid blind signature");
        return results.map((result) => {
          if (result.status !== "fulfilled") throw new Error("Invalid blind signature");
          return result.value;
        });
      } finally {
        for (const state of states) {
          state.inv.fill(0);
          state.prepared.fill(0);
        }
      }
    },
  };
}

export async function verifyBlindToken(
  issuerSpkiB64u: string,
  token: BlindToken,
): Promise<boolean> {
  try {
    if (token.key_id !== toHex(sha256(b64u.decode(issuerSpkiB64u))).slice(0, 16)) return false;
    const prepared = b64u.decode(token.prepared);
    if (prepared.length !== 64) return false;
    return await suite.verify(
      await importIssuer(issuerSpkiB64u),
      b64u.decode(token.signature),
      prepared,
    );
  } catch {
    return false;
  }
}
