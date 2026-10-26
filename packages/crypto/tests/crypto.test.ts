import { RSABSSA } from "@cloudflare/blindrsa-ts";
import sodium from "libsodium-wrappers-sumo";
import { beforeAll, describe, expect, it, vi } from "vitest";

import vectors from "../../../docs/specs/vectors/protocol-vectors.json";
import words from "../src/eff-large-wordlist.json";
import * as c from "../src/index.js";

beforeAll(async () => {
  await c.ready();
});

describe("Python interoperability vectors", () => {
  for (const vector of vectors.padme)
    it(`Padme ${vector.length}`, () => expect(c.padmeLength(vector.length)).toBe(vector.padded));
  const leaves = vectors.merkle.leaves_b64u.map(c.b64u.decode);
  const roots = vectors.merkle.roots as Record<string, string>;
  for (const [size, root] of Object.entries(roots))
    it(`Merkle root ${size}`, () =>
      expect(c.toHex(c.merkleRoot(leaves.slice(0, Number(size))))).toBe(root));
  for (const vector of vectors.merkle.inclusion)
    it(`inclusion ${vector.index}/${vector.tree_size}`, () => {
      const path = vector.path.map(c.fromHex);
      const root = c.fromHex(roots[vector.tree_size]!);
      expect(
        c.verifyInclusion(leaves[vector.index]!, vector.index, vector.tree_size, path, root),
      ).toBe(true);
      expect(
        c.verifyInclusion(c.utf8("modified"), vector.index, vector.tree_size, path, root),
      ).toBe(false);
      expect(
        c.verifyInclusion(
          leaves[vector.index]!,
          vector.index,
          vector.tree_size,
          [...path, root],
          root,
        ),
      ).toBe(false);
    });
  for (const vector of vectors.merkle.consistency)
    it(`consistency ${vector.first}/${vector.second}`, () => {
      const first = c.fromHex(roots[vector.first]!);
      const second = c.fromHex(roots[vector.second]!);
      const proof = vector.proof.map(c.fromHex);
      expect(c.verifyConsistency(vector.first, vector.second, first, second, proof)).toBe(true);
      expect(
        c.verifyConsistency(vector.first, vector.second, first, second, [...proof, first]),
      ).toBe(false);
      expect(c.verifyConsistency(vector.first, vector.second, first, c.sha256(second), proof)).toBe(
        false,
      );
    });
  it("evidence root", () =>
    expect(c.toHex(c.merkleRoot(vectors.merkle.evidence_root.file_sha256.map(c.fromHex)))).toBe(
      vectors.merkle.evidence_root.root,
    ));
  it("inbox salt and seed", () => {
    const salt = sodium.crypto_generichash(16, c.utf8("candor/v1/inbox-salt"), null);
    expect(c.b64u.encode(salt)).toBe(vectors.inbox.salt_b64u);
    const seed = sodium.crypto_pwhash(
      32,
      c.utf8(vectors.inbox.codename),
      salt,
      vectors.inbox.opslimit,
      vectors.inbox.memlimit,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
    expect(c.b64u.encode(seed)).toBe(vectors.inbox.seed_b64u);
  });
  for (const input of [vectors.inbox.codename, ...vectors.inbox.normalized_inputs])
    it(`inbox normalization ${input.length}`, async () => {
      expect(c.normalizeCodename(input)).toBe(vectors.inbox.codename);
      const keys = await c.deriveInboxKeys(input);
      expect(c.b64u.encode(keys.sign.publicKey)).toBe(vectors.inbox.sign_pk_b64u);
      expect(c.b64u.encode(keys.box.publicKey)).toBe(vectors.inbox.box_pk_b64u);
    });
  it("Python ciphertext", () => {
    const vector = vectors.candor_box;
    const box = vector.box as c.CandorBox;
    expect(c.decryptBox(c.b64u.decode(vector.key_b64u), box, c.utf8(vector.ad))).toEqual(
      c.utf8(vector.plaintext),
    );
    expect(box.n).toBe(vector.nonce_b64u);
    expect(() => c.decryptBox(c.b64u.decode(vector.key_b64u), box, c.utf8("wrong"))).toThrow();
  });
  it("key ID and STH message", () => {
    expect(c.keyId(c.b64u.decode(vectors.key_id.public_key_b64u))).toBe(vectors.key_id.key_id);
    expect(c.sthMessage(vectors.sth_message)).toEqual(c.utf8(vectors.sth_message.message));
  });
});

describe("envelopes and boundaries", () => {
  it("serializes JSON keys recursively in Python code point order", () => {
    const key = c.randomKey();
    const ad = c.utf8("test");
    const value = { z: [{ b: 1, a: "é" }], a: { "10": true, "2": false, "😀": 1, "\uE000": 2 } };
    const plaintext = new TextDecoder().decode(
      c.decryptBox(key, c.encryptJson(key, value, ad), ad),
    );
    expect(plaintext).toBe('{"a":{"10":true,"2":false,"\uE000":2,"😀":1},"z":[{"a":"é","b":1}]}');
  });
  it("round trips binary, Unicode JSON and seals", () => {
    const key = c.randomKey();
    const ad = c.context("manifest", "report");
    const value = { text: "Candor 🔒", count: 4 };
    const box = c.encryptJson(key, value, ad);
    expect(c.decryptJson(key, box, ad)).toEqual(value);
    expect(c.encryptJson(key, value, ad).n).not.toBe(box.n);
    expect(() => c.decryptBox(c.randomKey(), box, ad)).toThrow();
    expect(() => c.decryptBox(key, { ...box, v: 2 } as unknown as c.CandorBox, ad)).toThrow();
    const pair = c.generateBoxKeyPair();
    const seal = c.sealJson(value, pair.publicKey);
    expect(c.openSealJson(seal, pair.publicKey, pair.privateKey)).toEqual(value);
    const sealedKey = c.sealKey(key, pair.publicKey);
    expect(c.b64u.decode(sealedKey).length).toBe(80);
    expect(c.openSealedKey(sealedKey, pair.publicKey, pair.privateKey)).toEqual(key);
    expect(() => c.openSealedKey(sealedKey, pair.publicKey, c.randomKey())).toThrow();
    for (const size of [0, 1, 5, 1000, 65536]) {
      const data = new Uint8Array(size).fill(42);
      expect(c.decryptBox(key, c.encryptBox(key, data, ad), ad)).toEqual(data);
      expect(c.padmeUnframe(c.padmeFrame(data))).toEqual(data);
    }
  });
  it("rejects malformed encodings and frames", () => {
    for (const invalid of ["A", "AA=", "AB", "a+bc", "a/bc", " AA"])
      expect(() => c.b64u.decode(invalid)).toThrow();
    for (const invalid of ["Ff", "abc", "zz"]) expect(() => c.fromHex(invalid)).toThrow();
    for (const invalid of [-1, 0, 3, NaN, Infinity, 4.5])
      expect(() => c.padmeLength(invalid)).toThrow();
    expect(() => c.padmeUnframe(new Uint8Array(3))).toThrow();
    expect(() => c.padmeUnframe(new Uint8Array([0, 0, 0, 2, 0]))).toThrow();
    const badPadding = c.padmeFrame(new Uint8Array(5));
    badPadding[badPadding.length - 1] = 1;
    expect(() => c.padmeUnframe(badPadding)).toThrow();
    const bytes = Uint8Array.from({ length: 100000 }, (_, index) => index % 256);
    expect(c.b64u.decode(c.b64u.encode(bytes))).toEqual(bytes);
    expect(c.fromHex(c.toHex(bytes))).toEqual(bytes);
  });
  it("signatures and exact authentication messages", () => {
    const pair = c.generateSignKeyPair();
    const message = c.authMessage("reviewer", "challenge");
    const signature = c.signDetached(message, pair.privateKey);
    expect(message).toEqual(c.utf8("candor/v1/auth\nreviewer\nchallenge"));
    expect(c.inboxAuthMessage("pk", "challenge")).toEqual(
      c.utf8("candor/v1/inbox-auth\npk\nchallenge"),
    );
    expect(c.approvalMessage("request", "report", "requester")).toEqual(
      c.utf8("candor/v1/approve\nrequest\nreport\nrequester"),
    );
    expect(c.verifyDetached(signature, message, pair.publicKey)).toBe(true);
    expect(c.verifyDetached(signature, c.utf8("tampered"), pair.publicKey)).toBe(false);
    expect(c.verifyDetached(new Uint8Array(), message, pair.publicKey)).toBe(false);
    const head = { ...vectors.sth_message, key_id: c.keyId(pair.publicKey), signature: "" };
    head.signature = c.b64u.encode(c.signDetached(c.sthMessage(head), pair.privateKey));
    expect(c.verifySth(head, pair.publicKey)).toBe(true);
    expect(c.verifySth({ ...head, tree_size: 8 }, pair.publicKey)).toBe(false);
    expect(c.verifySth({ ...head, key_id: "incorrect" }, pair.publicKey)).toBe(false);
  });
  it("Merkle empty, equal, invalid and large sizes", () => {
    const empty = c.merkleRoot([]);
    const root = c.merkleRoot([c.utf8("a")]);
    expect(c.verifyConsistency(0, 1, empty, root, [])).toBe(true);
    expect(c.verifyConsistency(1, 1, root, root, [])).toBe(true);
    expect(c.verifyConsistency(1, 0, root, empty, [])).toBe(false);
    expect(c.verifyConsistency(0, 1, root, root, [])).toBe(false);
    expect(c.verifyInclusion(c.utf8("a"), 0, 0, [], empty)).toBe(false);
    expect(c.verifyInclusion(c.utf8("a"), -1, 1, [], root)).toBe(false);
    expect(c.verifyInclusion(c.utf8("a"), 0, 2 ** 33, [], root)).toBe(false);
  });
});

describe("threshold custody and codenames", () => {
  for (const [count, threshold] of [
    [2, 2],
    [5, 3],
    [8, 8],
    [255, 2],
  ])
    it(`Shamir ${threshold}/${count}`, async () => {
      const key = c.randomKey();
      const shares = await c.splitKey(key, count!, threshold!);
      expect(shares).toHaveLength(count!);
      expect(await c.combineShares(shares.slice(-threshold!))).toEqual(key);
      expect(await c.combineShares(shares)).toEqual(key);
      expect(await c.combineShares(shares.slice(0, threshold!).reverse())).toEqual(key);
    });
  it("rejects invalid thresholds and duplicate shares", async () => {
    for (const [count, threshold] of [
      [1, 1],
      [3, 1],
      [3, 4],
      [256, 2],
      [3, 2.5],
    ])
      await expect(c.splitKey(c.randomKey(), count!, threshold!)).rejects.toThrow();
    const shares = await c.splitKey(c.randomKey(), 3, 2);
    await expect(c.combineShares([shares[0]!, shares[0]!])).rejects.toThrow();
    await expect(c.combineShares([shares[0]!])).rejects.toThrow();
    const zeroIndex = shares[0]!.slice();
    zeroIndex[32] = 0;
    await expect(c.combineShares([zeroIndex, shares[1]!])).rejects.toThrow();
    const key = c.randomKey();
    const box = c.encryptBox(key, c.utf8("test"), new Uint8Array());
    const three = await c.splitKey(key, 3, 3);
    const insufficient = await c.combineShares(three.slice(0, 2));
    expect(() => c.decryptBox(insufficient, box, new Uint8Array())).toThrow();
  });
  it("EFF wordlist, entropy and rejection sampling", () => {
    expect(words).toHaveLength(7776);
    expect(new Set(words).size).toBe(7776);
    expect(Math.log2(words.length) * 8).toBeGreaterThan(103);
    const generated = Array.from({ length: 64 }, () => c.generateCodename());
    expect(new Set(generated).size).toBe(64);
    const wordSet = new Set(words);
    const countWords = (parts: string[], count: number): boolean => {
      if (!parts.length) return count === 0;
      if (count <= 0) return false;
      return [1, 2].some(
        (length) =>
          wordSet.has(parts.slice(0, length).join("-")) &&
          countWords(parts.slice(length), count - 1),
      );
    };
    for (const name of generated) {
      expect(countWords(name.split("-"), 8)).toBe(true);
    }
    expect(
      countWords("drop-down-felt-tip-t-shirt-yo-yo-abacus-abacus-abacus-abacus".split("-"), 8),
    ).toBe(true);
    const spy = vi.spyOn(crypto, "getRandomValues");
    spy.mockImplementationOnce((array) => {
      (array as Uint16Array)[0] = 65535;
      return array;
    });
    spy.mockImplementationOnce((array) => {
      (array as Uint16Array)[0] = 0;
      return array;
    });
    expect(c.generateCodename(1)).toBe(words[0]);
    spy.mockRestore();
    expect(() => c.generateCodename(0)).toThrow();
  });
});

it("RFC 9474 local issuer, standard PSS verification and tamper rejection", async () => {
  const suite = RSABSSA.SHA384.PSS.Randomized();
  const pair = await suite.generateKey({
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
  });
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const encoded = c.b64u.encode(spki);
  const id = c.toHex(c.sha256(spki)).slice(0, 16);
  const prepared = await c.prepareBlindTokens(encoded, id, 3);
  const signatures = await Promise.all(
    prepared.blindedMessages.map(async (message) =>
      c.b64u.encode(await suite.blindSign(pair.privateKey, c.b64u.decode(message))),
    ),
  );
  const tokens = await prepared.finalize(signatures);
  for (const token of tokens) {
    expect(await c.verifyBlindToken(encoded, token)).toBe(true);
    expect(
      await crypto.subtle.verify(
        { name: "RSA-PSS", saltLength: 48 },
        pair.publicKey,
        new Uint8Array(c.b64u.decode(token.signature)),
        new Uint8Array(c.b64u.decode(token.prepared)),
      ),
    ).toBe(true);
    expect(await c.verifyBlindToken(encoded, { ...token, key_id: "wrong" })).toBe(false);
    expect(
      await c.verifyBlindToken(encoded, { ...token, prepared: c.b64u.encode(c.randomKey()) }),
    ).toBe(false);
    expect(
      await c.verifyBlindToken(encoded, {
        ...token,
        signature: c.b64u.encode(new Uint8Array(256)),
      }),
    ).toBe(false);
  }
  await expect(prepared.finalize(signatures)).rejects.toThrow();
  const invalid = await c.prepareBlindTokens(encoded, id, 1);
  await expect(invalid.finalize([c.b64u.encode(new Uint8Array(256))])).rejects.toThrow();
  await expect(c.prepareBlindTokens(encoded, id, 0)).rejects.toThrow();
  await expect(c.prepareBlindTokens(encoded, "wrong", 1)).rejects.toThrow();
}, 30000);
