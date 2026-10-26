import { RSABSSA } from "@cloudflare/blindrsa-ts";

import vectors from "../../../docs/specs/vectors/protocol-vectors.json";
import * as c from "../src/index.js";

export async function checkBrowserCrypto(): Promise<number> {
  await c.ready();
  let checks = 0;
  const assert = (condition: boolean): void => {
    if (!condition) throw new Error("Browser crypto assertion failed");
    checks++;
  };
  const key = c.randomKey();
  const ad = c.context("manifest", "browser");
  const message = "Browser crypto fixture";
  assert(c.decryptJson<string>(key, c.encryptJson(key, message, ad), ad) === message);
  const pair = c.generateBoxKeyPair();
  assert(
    c.openSealJson<string>(c.sealJson(message, pair.publicKey), pair.publicKey, pair.privateKey) ===
      message,
  );
  const shares = await c.splitKey(key, 3, 2);
  assert(c.toHex(await c.combineShares(shares.slice(0, 2))) === c.toHex(key));
  const inbox = await c.deriveInboxKeys(vectors.inbox.normalized_inputs[0]!);
  assert(c.b64u.encode(inbox.sign.publicKey) === vectors.inbox.sign_pk_b64u);
  assert(c.b64u.encode(inbox.box.publicKey) === vectors.inbox.box_pk_b64u);
  const suite = RSABSSA.SHA384.PSS.Randomized();
  const issuer = await suite.generateKey({
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
  });
  const der = new Uint8Array(await crypto.subtle.exportKey("spki", issuer.publicKey));
  const spki = c.b64u.encode(der);
  const prepared = await c.prepareBlindTokens(spki, c.toHex(c.sha256(der)).slice(0, 16), 1);
  const blind = await suite.blindSign(
    issuer.privateKey,
    c.b64u.decode(prepared.blindedMessages[0]!),
  );
  const tokens = await prepared.finalize([c.b64u.encode(blind)]);
  assert(await c.verifyBlindToken(spki, tokens[0]!));
  return checks;
}
