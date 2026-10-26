# 07 · Client packages (`packages/crypto`, `packages/privacy`, `packages/sdk`)

All three are ESM TypeScript packages consumed as source by the Next.js app (`exports` points at
`src/index.ts`) and by Node tools. They must run in modern browsers and Node 22+. libsodium needs an
async `ready()`; every other function is synchronous unless it needs WebCrypto or WASM.

## `@candor/crypto` public API (`src/index.ts`)

```ts
ready(): Promise<void>
b64u.encode(bytes: Uint8Array): string; b64u.decode(text: string): Uint8Array
toHex(bytes: Uint8Array): string; fromHex(text: string): Uint8Array
utf8(text: string): Uint8Array
padmeLength(length: number): number
padmeFrame(plaintext: Uint8Array): Uint8Array
padmeUnframe(framed: Uint8Array): Uint8Array
context(purpose: string, reportId: string): Uint8Array
randomKey(): Uint8Array
type CandorBox = { v: 1; alg: "xc20p-padme"; n: string; c: string }
type SealBox = { v: 1; alg: "seal-padme"; c: string }
encryptBox(key, plaintext: Uint8Array, ad: Uint8Array): CandorBox
decryptBox(key, box: CandorBox, ad: Uint8Array): Uint8Array
encryptJson(key, value: unknown, ad): CandorBox; decryptJson<T>(key, box, ad): T
sealKey(bytes: Uint8Array, recipientPk: Uint8Array): string
openSealedKey(sealed: string, publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array
sealJson(value: unknown, recipientPk): SealBox; openSealJson<T>(box: SealBox, publicKey, privateKey): T
keyId(publicKey: Uint8Array): string
type KeyPair = { publicKey: Uint8Array; privateKey: Uint8Array }
generateBoxKeyPair(): KeyPair; generateSignKeyPair(): KeyPair
signDetached(message: Uint8Array, privateKey): Uint8Array
verifyDetached(signature: Uint8Array, message: Uint8Array, publicKey): boolean
splitKey(key: Uint8Array, shares: number, threshold: number): Promise<Uint8Array[]>
combineShares(shares: Uint8Array[]): Promise<Uint8Array>
generateCodename(words?: number): string
normalizeCodename(text: string): string
deriveInboxKeys(codename: string): Promise<{ sign: KeyPair; box: KeyPair }>
type BlindToken = { key_id: string; prepared: string; signature: string }
prepareBlindTokens(issuerSpkiB64u: string, keyId: string, count: number): Promise<{
  blindedMessages: string[];
  finalize(blindSignatures: string[]): Promise<BlindToken[]>;
}>
verifyBlindToken(issuerSpkiB64u: string, token: BlindToken): Promise<boolean>
sha256(bytes: Uint8Array): Uint8Array
leafHash(data: Uint8Array): Uint8Array; nodeHash(left, right): Uint8Array
merkleRoot(leaves: Uint8Array[]): Uint8Array
verifyInclusion(leaf: Uint8Array, index: number, treeSize: number, path: Uint8Array[], root: Uint8Array): boolean
verifyConsistency(first: number, second: number, firstRoot: Uint8Array, secondRoot: Uint8Array, proof: Uint8Array[]): boolean
type SignedTreeHead = { tree_size: number; root_hash: string; timestamp: string; key_id: string; signature: string }
sthMessage(sth): Uint8Array; verifySth(sth, logPublicKey: Uint8Array): boolean
authMessage(reviewerId: string, challenge: string): Uint8Array
inboxAuthMessage(sigPkB64u: string, challenge: string): Uint8Array
approvalMessage(requestId: string, reportId: string, requesterId: string): Uint8Array
```

The EFF large wordlist ships as `src/eff-large-wordlist.json` (array of 7776 words). Tests must
pass every vector in `docs/specs/vectors/protocol-vectors.json` (padme, merkle roots, inclusion,
consistency, evidence root, inbox salt and derived keys including normalisation inputs, CandorBox
decryption of the Python-produced ciphertext, key_id, sth message).

## `@candor/privacy` public API

```ts
type FileKind = "email" | "chat" | "memo" | "pdf" | "docx" | "csv" | "text" | "image" | "unsupported"
type MetadataField = { field: string; value: string; risk: "high" | "medium" | "low" }
type StrippedFile = {
  name: string; mime: string; kind: FileKind; originalSize: number; bytes: Uint8Array;
  sha256: string; metadataRemoved: MetadataField[]; metadataRemaining: MetadataField[];
  text: string | null; anchorDate: string | null; title: string
}
stripAndExtract(file: { name: string; type: string; bytes: Uint8Array }): Promise<StrippedFile>
type PiiType = "person" | "org" | "place" | "email" | "phone" | "id" | "account" | "url" | "ip" | "date_of_birth" | "other"
type Detection = { id: string; docKey: string; type: PiiType; text: string; start: number; end: number;
  source: "regex" | "ner" | "custom" | "self"; confidence: number }
detectPii(docs: { docKey: string; text: string }[], options: { selfTerms: string[]; customTerms?: string[] }): Detection[]
type RedactionDecision = { detectionId: string; action: "pseudonymise" | "redact" | "keep" }
type PseudonymEntry = { placeholder: string; type: PiiType; value: string; variants: string[] }
type ScrubResult = { documents: { docKey: string; text: string }[]; pseudonymMap: PseudonymEntry[];
  selfRedactionCount: number; counts: Record<string, number>; appliedDetections: number }
scrub(docs: { docKey: string; text: string }[], detections: Detection[], decisions?: RedactionDecision[]): ScrubResult
type LeakageReport = { score: number; level: "low" | "elevated" | "high";
  residual: { docKey: string; type: PiiType | "self"; text: string }[];
  quasiIdentifiers: { docKey: string; kind: string; text: string }[]; notes: string[] }
assessLeakage(result: ScrubResult, selfTerms: string[]): LeakageReport
buildAnalysisPayload(args: { reportId: string; campaignId: string; statementKey: string;
  files: StrippedFile[]; scrub: ScrubResult }): AnalysisPayload
```

Behaviour:
- Metadata stripping. PDF: pdf-lib clears Title, Author, Subject, Keywords, Creator, Producer,
  CreationDate, ModDate and removes the catalog `/Metadata` XMP stream; text via unpdf. DOCX: JSZip
  rewrites `docProps/core.xml` and `docProps/app.xml` (creator, lastModifiedBy, revision, dates,
  company, manager, template), deletes `docProps/custom.xml`, replaces `w:author` / `w:initials`
  attributes in comments and tracked changes with "Redacted"; text via mammoth. EML: postal-mime;
  remove `Received`, `X-Originating-IP`, `Message-ID`, `X-Mailer`, `User-Agent`, `Return-Path`,
  `DKIM-Signature`, `Authentication-Results`; keep Date (anchorDate), From, To, Cc, Subject which
  then go through PII detection; the stripped bytes are a re-serialised minimal RFC 822 message.
  Images (browser only): read EXIF/GPS/XMP with exifr for the report, then re-encode through
  OffscreenCanvas to drop all metadata; in Node return `kind: "image"` with a note. Text, Markdown,
  CSV: UTF-8 decode, strip BOM and zero-width characters (they can fingerprint).
- `metadataRemoved` lists what was found and removed, with `high` risk for names, emails, GPS,
  device serials, usernames and company; `metadataRemaining` must be empty for supported kinds.
- PII detection combines regex families (emails, phones via libphonenumber-js findPhoneNumbersInText
  with default region US, IBAN with checksum, card numbers with Luhn, SSN-like, IPv4/IPv6, URLs,
  employee/badge IDs like `EMP-12345`, dates of birth near "DOB"/"born"), compromise NER for people,
  organisations and places (filter stopwords and capitalised sentence starters), custom terms, and
  self terms. Self terms and their variants (each name token >= 3 letters, email local part,
  digits-only phone forms) are matched case-insensitively and always win.
- Scrub: self terms become `[REDACTED]`; others become consistent placeholders per type
  (`PERSON_1`, `ORG_1`, `EMAIL_1`, `PHONE_1`, `ID_1`, `ACCOUNT_1`, `URL_1`, `PLACE_1`); first-name or
  surname-only mentions link to the full-name placeholder when unambiguous; email addresses whose
  local part matches a person link to that person's placeholder family as `EMAIL_n`.
- Leakage score 0-100: weighted residual direct identifiers (self term remnants 40 each, emails/
  phones 25, names 15), plus quasi-identifiers (job titles with team names, exact small headcounts,
  rare locations, first-person role statements like "as the only nurse on night shift", exact
  timestamps) 5 each, capped at 100. `level`: < 15 low, < 40 elevated, else high. Notes explain the
  biggest contributors in plain English.
- CLI `src/cli.ts` (built to `dist/cli.js`): `scrub --dir <scenario dir> --self-terms <json array
  or path> --out <file> [--report-id <id>] [--campaign-id <id>]`. Statement file is
  `reporter_statement.txt`; `ground_truth.json` and `README*` are ignored; every other file is a
  document, ordered by name. Auto-pseudonymises all detections. Output JSON:
  `{ payload, pseudonym_map, stripped_files: [{ name, kind, metadata_before, metadata_after }],
  leakage_estimate }`.

`AnalysisPayload` must exactly match `services/pipeline/src/candor_pipeline/contracts.py`
(snake_case keys, `doc_id` `D1..Dn` in file order, statement as `reporter_statement`, `kind`
mapping image/unsupported files out of the payload, `anchor_date` ISO date or null,
`entity_legend` from the pseudonym map, `redaction_summary` counts).

## `@candor/sdk` (built after the API lands)

Typed client for the identity service and the API (types generated from
`services/api/openapi.json` with openapi-typescript into `src/api.generated.ts`, and from the
pipeline contracts via JSON Schema into `src/contracts.generated.ts`), the submission builder
(01-protocols), reviewer helpers (sign-in, open findings, quorum approve/combine, decrypt files and
manifest, re-identify a result with the pseudonym map), inbox helpers, x402 helpers (mock and
wallet), transparency-log verification helpers, and the `seed:demo` CLI.
