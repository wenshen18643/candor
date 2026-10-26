# libsodium browser/Node <-> PyNaCl interoperability

Verified **2026-10-26** against live registries, installed sources and a bidirectional executable fixture. Node **24.15.0**, Python **3.13.7**, Windows. Browser runtime was not exercised; upstream supports browsers and Node, and the package provides ESM and CommonJS entry points.

## Versions / install / configuration

- npm **`libsodium-wrappers-sumo@0.8.4`** (latest; 2026-04-19); resolved **`libsodium-sumo@0.8.4`**; JS runtime reports libsodium **1.0.22**.
- PyPI **`PyNaCl==1.6.2`** (latest; 2026-01-01), imported as **`nacl`**. Its public Python bindings do not expose `sodium_version_string`; no native-library version is inferred here.

```powershell
# Inside a fresh directory under $env:TEMP
npm init -y
npm install --save-exact libsodium-wrappers-sumo@0.8.4
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install PyNaCl==1.6.2
```

No credentials/env vars. Always `import sodium from 'libsodium-wrappers-sumo'; await sodium.ready;` before using functions/constants. Use **sumo** for password hashing. The installed 0.8.4 ESM entry imported successfully without deep-path workarounds. Browser deployment needs working WebAssembly/JS support and secure randomness; run expensive KDF work in a Web Worker.

Local sandbox blocked pip's temporary-file handling. Tests instead used official PyPI wheels extracted into a temporary venv (PyNaCl 1.6.2, cffi 2.1.1, pycparser 3.12). No dependency files were added to the repository.

## Exact calls and binary formats

Here `s` is initialized sodium; `b` is `from nacl import bindings as b`. JS calls return `Uint8Array` unless indicated. Python calls use raw `bytes`.

| Operation | JS | Python | Format / result |
|---|---|---|---|
| Seal | `s.crypto_box_seal(msg, pk)` | `SealedBox(PublicKey(pk)).encrypt(msg)` | 32-byte Curve25519 pk; ciphertext = plaintext + 48 bytes |
| Open seal | `s.crypto_box_seal_open(ct, pk, sk)` | `SealedBox(PrivateKey(sk)).decrypt(ct)` | 32-byte sk; raises on failure |
| AEAD encrypt | `s.crypto_aead_xchacha20poly1305_ietf_encrypt(msg, aad, null, nonce, key)` | `b.crypto_aead_xchacha20poly1305_ietf_encrypt(msg, aad, nonce, key)` | key 32, nonce 24, ciphertext includes trailing 16-byte tag |
| AEAD decrypt | `s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, aad, nonce, key)` | `b.crypto_aead_xchacha20poly1305_ietf_decrypt(ct, aad, nonce, key)` | Nonce is transmitted separately, not prepended by these calls |
| Detached sign | `s.crypto_sign_detached(msg, sk64)` | `SigningKey(seed32).sign(msg).signature` | Ed25519 signature 64 bytes |
| Detached verify | `s.crypto_sign_verify_detached(sig, msg, pk32)` | `VerifyKey(pk32).verify(msg, sig)` | JS boolean; Python returns message or raises `BadSignatureError` |
| BLAKE2b | `s.crypto_generichash(32, msg, key)` | `nacl.hash.blake2b(msg, digest_size=32, key=key, encoder=RawEncoder)` | Optional key; output length must match exactly |
| Argon2id | `s.crypto_pwhash(32, password, salt, ops, mem, s.crypto_pwhash_ALG_ARGON2ID13)` | `nacl.pwhash.argon2id.kdf(32, password, salt, opslimit=ops, memlimit=mem)` | salt 16 bytes; algorithm numeric ID 2 |
| Box from seed | `s.crypto_box_seed_keypair(seed32)` | `b.crypto_box_seed_keypair(seed32)` | JS `{publicKey,privateKey,keyType}`; Python `(pk32,sk32)` |
| Sign from seed | `s.crypto_sign_seed_keypair(seed32)` | `b.crypto_sign_seed_keypair(seed32)` | JS object; Python `(pk32,sk64)` |

Python high-level imports: `from nacl.public import PublicKey, PrivateKey, SealedBox`; `from nacl.signing import SigningKey, VerifyKey`; `from nacl.encoding import RawEncoder`. `nacl.bindings.crypto_generichash` is a **module**, not a callable. `nacl.hash.blake2b` defaults to **hex encoding**; request `RawEncoder` for JS-compatible bytes.

Measured constants on both sides (JS prefix `crypto_pwhash_`; Python `nacl.pwhash.argon2id.`):

| Preset | OPSLIMIT | MEMLIMIT in bytes |
|---|---:|---:|
| INTERACTIVE | 2 | 67,108,864 (64 MiB) |
| MODERATE | 3 | 268,435,456 (256 MiB) |
| SENSITIVE | 4 | 1,073,741,824 (1 GiB) |

**Pass explicit limits**: PyNaCl 1.6.2 `argon2id.kdf` defaults to 4 / 1 GiB. ALG_ARGON2ID13 = 2 is Argon2id version 1.3; libsodium uses parallelism 1. Persist algorithm, output length, salt, opslimit, memlimit and password encoding policy together; do not depend on a future `ALG_DEFAULT`.

## Executed round trip (reproducible)

Save as `sodium.mjs` and `sodium.py` in the temporary project. Fixed salt/key/nonce and exported secrets below are **test fixtures only**. In the product generate a new random 16-byte salt per KDF context and random 24-byte nonce per AEAD encryption; never reuse a nonce with a key for different messages.

```js
import sodium from 'libsodium-wrappers-sumo';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
await sodium.ready;
const enc=new TextEncoder(), hex=x=>sodium.to_hex(x), dec=x=>sodium.from_hex(x);
const message=enc.encode('Candor interop: \u{1f512}'), aad=enc.encode('candor:v1:report');
const password=enc.encode('test-only-password'), salt=Uint8Array.from({length:16},(_,i)=>i);
const seed=sodium.crypto_pwhash(32,password,salt,sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,sodium.crypto_pwhash_ALG_ARGON2ID13);
const box=sodium.crypto_box_seed_keypair(seed), sign=sodium.crypto_sign_seed_keypair(seed);
const key=Uint8Array.from({length:32},(_,i)=>i+1), nonce=Uint8Array.from({length:24},(_,i)=>i+2);
const output={message:hex(message),aad:hex(aad),password:hex(password),salt:hex(salt),seed:hex(seed),boxPk:hex(box.publicKey),boxSk:hex(box.privateKey),signPk:hex(sign.publicKey),signSk:hex(sign.privateKey),key:hex(key),nonce:hex(nonce),sealed:hex(sodium.crypto_box_seal(message,box.publicKey)),aead:hex(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(message,aad,null,nonce,key)),signature:hex(sodium.crypto_sign_detached(message,sign.privateKey)),hash:hex(sodium.crypto_generichash(32,message)),keyedHash:hex(sodium.crypto_generichash(32,message,key))};
if (process.argv[2]==='write') {
 writeFileSync('sodium-js.json',JSON.stringify(output));
 console.log('JS fixtures written; libsodium '+sodium.sodium_version_string());
} else {
 const py=JSON.parse(readFileSync('sodium-python.json','utf8'));
 assert.deepEqual(sodium.crypto_box_seal_open(dec(py.sealed),box.publicKey,box.privateKey),message);
 assert.deepEqual(sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null,dec(py.aead),aad,nonce,key),message);
 assert(sodium.crypto_sign_verify_detached(dec(py.signature),message,sign.publicKey));
 for (const k of ['seed','boxPk','boxSk','signPk','signSk','hash','keyedHash','aead','signature']) assert.equal(output[k],py[k],k);
 assert.throws(()=>sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null,dec(py.aead),enc.encode('wrong'),nonce,key));
 const bad=dec(py.signature); bad[0]^=1; assert(!sodium.crypto_sign_verify_detached(bad,message,sign.publicKey));
 console.log('PASS Python -> JS: sealed box, XChaCha20+AAD, Ed25519, BLAKE2b keyed/unkeyed, Argon2id, box/sign seed keypairs; tampering rejected');
 console.log(JSON.stringify({seed:output.seed,hash:output.hash,boxPk:output.boxPk,signPk:output.signPk,sealedBytes:dec(py.sealed).length,messageBytes:message.length}));
}
```

```python
import json
from pathlib import Path
from nacl.public import PrivateKey,PublicKey,SealedBox
from nacl.signing import SigningKey,VerifyKey
from nacl import bindings as b,pwhash,hash,encoding
from nacl.exceptions import CryptoError,BadSignatureError
x=json.loads(Path('sodium-js.json').read_text()); d=bytes.fromhex
message,aad,key,nonce=[d(x[k]) for k in ('message','aad','key','nonce')]
seed=pwhash.argon2id.kdf(32,d(x['password']),d(x['salt']),opslimit=2,memlimit=67108864)
box_pk,box_sk=b.crypto_box_seed_keypair(seed)
sign_pk,sign_sk=b.crypto_sign_seed_keypair(seed)
assert SealedBox(PrivateKey(box_sk)).decrypt(d(x['sealed']))==message
assert b.crypto_aead_xchacha20poly1305_ietf_decrypt(d(x['aead']),aad,nonce,key)==message
assert VerifyKey(sign_pk).verify(message,d(x['signature']))==message
out={'seed':seed,'boxPk':box_pk,'boxSk':box_sk,'signPk':sign_pk,'signSk':sign_sk,
 'sealed':SealedBox(PublicKey(box_pk)).encrypt(message),
 'aead':b.crypto_aead_xchacha20poly1305_ietf_encrypt(message,aad,nonce,key),
 'signature':SigningKey(seed).sign(message).signature,
 'hash':hash.blake2b(message,digest_size=32,encoder=encoding.RawEncoder),
 'keyedHash':hash.blake2b(message,key=key,digest_size=32,encoder=encoding.RawEncoder)}
for k in ('seed','boxPk','boxSk','signPk','signSk','hash','keyedHash','aead','signature'): assert out[k].hex()==x[k],k
try:
 b.crypto_aead_xchacha20poly1305_ietf_decrypt(d(x['aead']),b'wrong',nonce,key)
 raise AssertionError('bad AAD accepted')
except CryptoError: pass
bad=bytearray(d(x['signature'])); bad[0]^=1
try:
 VerifyKey(sign_pk).verify(message,bytes(bad)); raise AssertionError('bad signature accepted')
except BadSignatureError: pass
Path('sodium-python.json').write_text(json.dumps({k:v.hex() for k,v in out.items()}))
print('PASS JS -> Python: sealed box, XChaCha20+AAD, Ed25519, BLAKE2b keyed/unkeyed, Argon2id, box/sign seed keypairs; tampering rejected')

```

```powershell
node sodium.mjs write
.\.venv\Scripts\python.exe sodium.py
node sodium.mjs verify
```

Both directions printed **PASS** for sealed boxes, XChaCha20-Poly1305 with AAD, Ed25519, keyed/unkeyed BLAKE2b, Argon2id and both seeded keypairs. Wrong AAD and flipped signature bits were rejected in both runtimes. JS/Python hashes, KDF outputs, public/private keys, signatures and deterministic AEAD ciphertexts matched byte-for-byte; sealed ciphertexts differ randomly but decrypt correctly in each direction.

Stable fixture values:

```text
message UTF-8 length: 20; sealed ciphertext: 68 bytes
Argon2id seed: c84310b4629961b1ff1241840d17187aae60027933b02163fc5956314ae37009
BLAKE2b-256: 6a75690b4ac8559c686c4d16a920b33c295c885e17c42156dd23b494c78b8a89
box public: 50d091416aaec2bae9a10544835d2d9a91b8b1fd13967619119b7a877393bf2d
sign public: 65f516424df1f7dc79c26d2c476cb5263fbe8c60f1db6bba54ab03d3318ef417
```

## Gotchas for Candor

- A sodium Ed25519 secret key is 64 bytes (`seed || public key`); `SigningKey` accepts the 32-byte seed. `bytes(SigningKey(seed))` is the seed, not sodium's 64-byte key.
- `PrivateKey(seed)` is **not** `crypto_box_seed_keypair(seed)`: the latter derives the actual Curve25519 secret. Use the binding and then `PrivateKey(sk)` as tested.
- Deriving both key types from one seed is useful for this interop test. For application keys, derive separate purpose-labelled subkeys/seeds from a master key and keep the derivation/version stable across clients.
- Sealed boxes authenticate ciphertext integrity and recipient possession, **not sender identity**, and expose no AAD parameter. Use the AEAD construction when an external report identifier/version must be authenticated.
- Plain Ed25519 is tested; do not replace it with Ed25519ph or sign a hex string/hash on only one side. Hashes are parameterized: BLAKE2b-256 is not a truncated BLAKE2b-512 digest.
- Preserve exact UTF-8 bytes for password, plaintext and AAD. Specify any Unicode normalization as a protocol rule. Binary JSON transport needs explicit base64/hex encoding; raw JS JSON-serialized typed arrays are not portable bytes.
- JS AEAD/box authentication failures throw; Python raises `CryptoError`. Handle failure without returning partial plaintext. Bound KDF concurrency and input sizes for browser memory budgets.

## Sources

- [npm wrappers metadata](https://registry.npmjs.org/libsodium-wrappers-sumo/0.8.4), [npm native bundle](https://registry.npmjs.org/libsodium-sumo/0.8.4), [PyPI 1.6.2](https://pypi.org/pypi/PyNaCl/1.6.2/json).
- [libsodium.js README](https://github.com/jedisct1/libsodium.js), [sumo API](https://github.com/jedisct1/libsodium.js/blob/master/API_sumo.md).
- [Sealed boxes](https://libsodium.gitbook.io/doc/public-key_cryptography/sealed_boxes), [XChaCha20-Poly1305](https://libsodium.gitbook.io/doc/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction), [password hashing](https://libsodium.gitbook.io/doc/password_hashing/default_phf).
- [PyNaCl public-key API](https://pynacl.readthedocs.io/en/latest/public/), [signatures](https://pynacl.readthedocs.io/en/latest/signing/), [password hashing](https://pynacl.readthedocs.io/en/latest/password_hashing/).
- The `/en/latest/bindings/` documentation URL was unavailable through the web tool; exact binding signatures were verified by local `inspect.signature` and the successful tests, not guessed.
