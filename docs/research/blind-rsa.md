# RFC 9474 blind RSA: verified implementation notes

Verified 2026-10-26 using live npm/PyPI metadata, the installed release sources, and executable cross-language fixtures. Runtime: Windows, Node **24.15.0**, Python **3.13.7**. All installations/experiments were under `%TEMP%`, outside the repository.

## Versions and installation

| Package | Latest stable observed and tested | Notes |
|---|---|---|
| `@cloudflare/blindrsa-ts` | **0.4.6**, published 2026-06-19 | npm declares Node `>=24`; ESM; resolved `sjcl@1.0.9` |
| `cryptography` | **50.0.2**, published 2026-09-30 | Python import is `cryptography`, not `crypto` |

```powershell
# Run in a fresh directory under $env:TEMP.
npm init -y
npm install --save-exact @cloudflare/blindrsa-ts@0.4.6
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install cryptography==50.0.2
```

No service credentials or environment variables. Browsers require WebCrypto (`crypto.subtle`, `crypto.getRandomValues`) in a secure context. Browser ESM bundling passed with esbuild 0.28.2; execution was tested in Node, not a browser. This is **RSABSSA**, not the partially blind `RSAPBSSA` suite (which has additional browser restrictions).

Local sandbox detail: pip/ensurepip failed with temporary-file permission errors. The exact official PyPI wheels were downloaded and extracted into the temporary venv's `Lib/site-packages`; successful imports and all tests below used that venv. Dependencies: cffi 2.1.1, pycparser 3.12. The install command above is the ordinary supported installation route.

## Exact API

```ts
import { RSABSSA } from '@cloudflare/blindrsa-ts';
const suite = RSABSSA.SHA384.PSS.Randomized();
// Optional argument: { supportsRSARAW: boolean }; default false.
// The README's singular `supportRSARAW` is a typo; declarations/source use supportsRSARAW.
const { publicKey, privateKey } = await suite.generateKey({
  modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]),
}); // Promise<CryptoKeyPair>, RSA-PSS/SHA-384, extractable keys
const message = new TextEncoder().encode('Candor');
const prepared = suite.prepare(message); // Uint8Array; synchronous; 32 random bytes || message
const { blindedMsg, inv } = await suite.blind(publicKey, prepared);
// Promise<{ blindedMsg: Uint8Array; inv: Uint8Array }>
const blindSig = await suite.blindSign(privateKey, blindedMsg); // Promise<Uint8Array>
const signature = await suite.finalize(publicKey, prepared, blindSig, inv);
const valid = await suite.verify(publicKey, signature, prepared); // Promise<boolean>
const spki = await crypto.subtle.exportKey('spki', publicKey); // DER ArrayBuffer
```

`finalize` takes **message before blind signature**; `verify` takes **signature before message**. All protocol bytes are `Uint8Array`. Only `blindedMsg` goes to the signer; keep `inv` and the prepared message client-side during issuance. Preserve the prepared message for subsequent verification; do not call `prepare()` again. `finalize` verifies its output and rejects invalid signatures.

## Reproducible experiment that was run

Save the following as `rsa.mjs` and `rsa.py` in the temporary directory. This fixture deliberately exports a private key to a local file so both implementations can sign with the same key; that is **not** a network protocol or production key-distribution pattern.

```js
import { RSABSSA } from '@cloudflare/blindrsa-ts';
import { writeFileSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
if (process.argv[2] === 'setup') {
const suite = RSABSSA.SHA384.PSS.Randomized();
const { publicKey, privateKey } = await suite.generateKey({ modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]) });
const msg = new TextEncoder().encode('Candor RFC9474 interoperability');
const prepared = suite.prepare(msg);
const { blindedMsg, inv } = await suite.blind(publicKey, prepared);
const b64 = x => Buffer.from(x).toString('base64');
const data = { spki: b64(await crypto.subtle.exportKey('spki', publicKey)), pkcs8: b64(await crypto.subtle.exportKey('pkcs8', privateKey)), msg:b64(msg), prepared:b64(prepared), blinded:b64(blindedMsg) };
writeFileSync('rsa-input.json',JSON.stringify(data));
writeFileSync('rsa-inv.bin',inv);
} else {
const suite = RSABSSA.SHA384.PSS.Randomized();
const data = JSON.parse(readFileSync('rsa-input.json'));
const dec = x => new Uint8Array(Buffer.from(x,'base64'));
const b64 = x => Buffer.from(x).toString('base64');
const publicKey = await crypto.subtle.importKey('spki',dec(data.spki),{name:'RSA-PSS',hash:'SHA-384'},true,['verify']);
const privateKey = await crypto.subtle.importKey('pkcs8',dec(data.pkcs8),{name:'RSA-PSS',hash:'SHA-384'},true,['sign']);
const prepared=dec(data.prepared), msg=dec(data.msg), blindedMsg=dec(data.blinded), inv=new Uint8Array(readFileSync('rsa-inv.bin'));
const pythonBlind = new Uint8Array(readFileSync('rsa-python-blind.bin'));
const jsBlind = await suite.blindSign(privateKey, blindedMsg);
assert.deepEqual(pythonBlind,jsBlind);
const signatures = {};
for (const [name, blindSig] of [['js',jsBlind],['python',pythonBlind]]) {
 const signature = await suite.finalize(publicKey,prepared,blindSig,inv);
 assert(await suite.verify(publicKey,signature,prepared));
 assert(!(await suite.verify(publicKey,signature,msg)));
 signatures[name]=b64(signature);
}
writeFileSync('rsa-signatures.json',JSON.stringify(signatures));
console.log(JSON.stringify({suite:suite.toString(),preparedBytes:prepared.length,messageBytes:msg.length,signatureBytes:256,blindSignaturesEqual:true,node:process.version}));
}
```

```python
import base64,json,sys
from pathlib import Path
from cryptography.hazmat.primitives import serialization,hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.exceptions import InvalidSignature
x=json.loads(Path('rsa-input.json').read_text()); dec=base64.b64decode
if sys.argv[1]=='sign':
 key=serialization.load_der_private_key(dec(x['pkcs8']),password=None)
 numbers=key.private_numbers(); n=numbers.public_numbers.n; e=numbers.public_numbers.e
 blinded=dec(x['blinded']); k=(n.bit_length()+7)//8; m=int.from_bytes(blinded,'big')
 assert len(blinded)==k and 0<=m<n
 s=pow(m,numbers.d,n)
 assert pow(s,e,n)==m
 Path('rsa-python-blind.bin').write_bytes(s.to_bytes(k,'big'))
 print('PASS Python raw RSA blind signing')
else:
 key=serialization.load_der_public_key(dec(x['spki']))
 for name,sig in json.loads(Path('rsa-signatures.json').read_text()).items():
  key.verify(dec(sig),dec(x['prepared']),padding.PSS(mgf=padding.MGF1(hashes.SHA384()),salt_length=48),hashes.SHA384())
  try:
   key.verify(dec(sig),dec(x['msg']),padding.PSS(mgf=padding.MGF1(hashes.SHA384()),salt_length=48),hashes.SHA384())
   raise AssertionError('unprepared message unexpectedly verified')
  except InvalidSignature: pass
  print('PASS Python PSS verify: '+name+' signer; unprepared message rejected')

```

```powershell
node rsa.mjs setup
.\.venv\Scripts\python.exe rsa.py sign
node rsa.mjs finish
.\.venv\Scripts\python.exe rsa.py verify
```

Observed: Python raw RSA signing passed; JS and Python blind signatures were byte-identical; both finalized signatures verified in JS and Python; both rejected verification against the unprepared message. Message length **31**, prepared length **63**, signature length **256** bytes; suite string `RSABSSA-SHA384-PSS-Randomized`.

## Serialization and implementation boundaries

- **Public key:** WebCrypto `exportKey('spki', publicKey)` produces DER SubjectPublicKeyInfo, consumed by `serialization.load_der_public_key`. WebCrypto re-import uses `importKey('spki', der, {name:'RSA-PSS', hash:'SHA-384'}, true, ['verify'])`.
- **Private key:** WebCrypto `exportKey('pkcs8', privateKey)` produces DER PKCS#8, consumed by `serialization.load_der_private_key(der, password=None)`. WebCrypto re-import uses format `pkcs8`, RSA-PSS/SHA-384, `extractable: true`, usages `['sign']`. Both imports were exercised above.
- PEM is base64-wrapped DER with `PUBLIC KEY` / `PRIVATE KEY` labels; Python uses `load_pem_public_key` / `load_pem_private_key`. Strip PEM framing and base64-decode before WebCrypto import. PKCS#1 `RSA PUBLIC KEY` is not SPKI.
- Python-origin serialization: `key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)` and `key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())`. Generate with `rsa.generate_private_key(public_exponent=65537, key_size=2048)` from `cryptography.hazmat.primitives.asymmetric`.
- Encode wire byte arrays as base64 explicitly. RSA integers use **unsigned big-endian**, and blind messages/signatures must retain modulus-width zero padding. For 2048-bit RSA, width is 256 bytes.
- `cryptography` verification is ordinary PSS over the **prepared bytes**, SHA-384, MGF1-SHA384, salt length **48**; do not use `PSS.MAX_LENGTH`, PKCS#1 v1.5, or `Prehashed` with these inputs.
- `private_key.sign(blindedMsg, PSS(...), SHA384())` is **not** blind signing: it adds a second hash/padding layer. The experiment uses `pow(m, d, n)` and a public-exponent fault check as required by the protocol.
- Python `pow` with a secret exponent is not constant-time. This proves interoperability, not a hardened online signer. A production signer needs a side-channel-resistant raw RSA implementation, length/range checks using exceptions (not test assertions), a dedicated signing key, and issuance authorization. RFC 9474 §7.1 covers this directly.
- `blind`/`finalize`, and default `blindSign`, export JWK internally and reject non-extractable keys. Do not enable the platform-specific RSA-RAW option on an ordinary browser/Node WebCrypto implementation.

## Sources

- [npm exact release metadata](https://registry.npmjs.org/@cloudflare%2fblindrsa-ts/0.4.6) and [PyPI cryptography 50.0.2](https://pypi.org/pypi/cryptography/50.0.2/json).
- [Cloudflare README](https://github.com/cloudflare/blindrsa-ts), [release API declarations](https://unpkg.com/@cloudflare/blindrsa-ts@0.4.6/lib/src/blindrsa.d.ts), [release implementation](https://unpkg.com/@cloudflare/blindrsa-ts@0.4.6/lib/src/blindrsa.js).
- [RFC 9474](https://www.rfc-editor.org/rfc/rfc9474.html): §§4–5 protocol/variants, §6.2 key separation, §7.1 side channels.
- [cryptography RSA API](https://cryptography.io/en/latest/hazmat/primitives/asymmetric/rsa/) (latest docs identified themselves as 51.0.0-dev1; the actual tested installed package was 50.0.2).
