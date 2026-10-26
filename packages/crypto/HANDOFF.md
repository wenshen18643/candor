# Crypto handoff

Implemented every public API in spec 07: strict base64url/hex codecs, Padmé framing, XChaCha20-Poly1305 envelopes, sealed keys/JSON, X25519/Ed25519 keys and signatures, Shamir custody, EFF codenames and Argon2id inbox keys, RFC 9474 blind tokens, RFC 9162 roots/proof verification, signed tree heads, and authentication messages. JSON encryption sorts object keys recursively. No remote integration or environment configuration is needed; cryptographic randomness is always real.

Import from `@candor/crypto` and await `ready()` before sodium operations. Keep private keys, shares, issuance state and plaintext in client memory. Blind issuance validates the SPKI-derived key ID and consumes its finalizer once. Reconstructing insufficient or corrupt Shamir shares can produce a wrong key; authenticate it by decrypting the envelope.

Run from the repository root:

```text
pnpm --filter @candor/crypto test
pnpm --filter @candor/crypto typecheck
pnpm exec eslint packages/crypto packages/privacy
pnpm exec prettier --check packages/crypto packages/privacy
```

Final test summary:

```text
Test Files  1 passed (1)
     Tests  67 passed (67)
```

All shared Python vectors pass, including every Merkle proof, inbox normalization/KDF, Python ciphertext and evidence root. Additional tests cover malformed inputs, tampering, threshold edges through 255 shares, signatures, rejection sampling, and local blind issuance plus independent WebCrypto PSS verification. Typechecking, ESLint and Prettier pass. Browser-target bundling passes; `tests/browser-smoke.ts` contains runtime checks, but Chromium execution could not complete in this Windows sandbox. Node execution used 24.15.0; Node 22 was not separately exercised.

Implementation choices: Vitest uses threads because sandboxed process forks fail. Shamir requires `2 <= threshold <= shares <= 255`, matching the dependency. Issuance batches are limited to 100 and codename generation to 128 words. The exact 7,776-entry EFF list is included; four entries contain internal hyphens, so eight selected words do not always produce eight hyphen-separated pieces. No protocol-format deviations.
