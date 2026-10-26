# Candor

**Say what happened, not who you are.**

Candor is a whistleblowing platform built on two promises that usually pull against each other:
the person reporting reveals as little about themselves as possible, and the people reviewing get
an account of what happened that they can actually trust. A multi-stage Meta Muse pipeline turns
scattered, redacted evidence into a cited timeline in which every sentence traces back to a verbatim
source passage, with uncertainty and contradictions shown rather than smoothed over.

- **Live demo:** https://candor-whistle.vercel.app (showcase mode: every cryptographic step runs
  for real in your browser, and nothing is sent anywhere). The analysis in the reviewer console is
  a recorded run of the real twelve-stage pipeline on the fictional Northwind case, made with
  `gpt-6.1-sol` through the Codex CLI while Meta Muse access was pending; the model calls are
  committed as cassettes in `services/pipeline/tests/cassettes/northwind` and replay exactly.
- **Built for:** Meta Global AI Developer Hackathon, indie track

## Try it in five minutes

| Page                       | What to look for                                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/report/northwind-ethics` | The reporter flow. Use test passport A, load the sample evidence, watch metadata get stripped from a real PDF and DOCX, toggle redactions, then seal. Every step shows its real timing. |
| `/console`                 | Sign in as a reviewer, open the Northwind report, read the brief, follow any claim to its quote, open the evidence with a 2-of-3 quorum.                                                |
| `/audit`                   | Verify the transparency log yourself, then tamper with an entry and watch the proofs fail.                                                                                              |
| `/inbox`                   | Read the reviewers' follow-up questions with the demo codename and reply anonymously.                                                                                                   |
| `/architecture`            | Every mechanism, with diagrams, the threat model and the source file behind each claim.                                                                                                 |
| `/evals`                   | Leakage, grounding, timeline accuracy and invalid-output handling on synthetic evidence.                                                                                                |

## How it works

### 1. Prove you may report, without saying who you are

- **Self passport proof.** The reporter scans a QR code with the Self app, which reads the passport
  chip and produces a zero-knowledge proof of "over 18 and not sanctioned". The identity service
  learns a yes or no and a campaign-scoped nullifier, nothing else.
- **Scoped nullifier quota.** The nullifier is HMAC-tagged per campaign and epoch, so one passport
  can make at most three reports per channel per month, and nullifiers from different channels
  cannot be linked.
- **RFC 9474 blind RSA tokens.** The browser blinds three random token messages; the identity
  service signs them without seeing them (RSABSSA-SHA384-PSS-Randomized); the browser unblinds. When
  a token is later redeemed at the API, nobody can connect it to the verification that minted it.
  Identity, reports and payments live in three separate databases with no shared keys.

### 2. Clean evidence on the device

- Metadata stripping for PDF (Info dictionary, XMP and document IDs), DOCX (core, app and custom
  properties, thumbnails, revision authors and dates, ZIP timestamps), email (Received,
  X-Originating-IP and other tracing headers, attachments) and images (EXIF and GPS removed by canvas
  re-encoding), verified in tests by re-parsing the output bytes.
- PII detection (regex, NER and the reporter's own self-identifiers), consistent pseudonyms across
  all documents (`PERSON_1`, `ORG_2`), first-name linking, and a re-identification risk score that
  also flags quasi-identifiers such as unique roles, small headcounts and exact times.
- The reporter approves every replacement and chooses per file whether reviewers get redacted text or
  the cleaned original.

### 3. Seal so that no single party can read it

- A fresh 256-bit report key encrypts each file and the manifest with XChaCha20-Poly1305, after
  Padmé padding so ciphertext sizes leak almost nothing.
- The report key is split with Shamir secret sharing (2-of-3 by default) and each share is sealed to
  one reviewer's X25519 key. The server stores only ciphertext and sealed shares.
- The redacted, pseudonymised analysis view is sealed separately to the analysis worker's key.
- An 8-word EFF diceware codename (about 103 bits) is stretched with Argon2id into Ed25519 and X25519
  inbox keys, giving the reporter an anonymous two-way channel.
- A random delay before submission weakens timing correlation with verification.

### 4. Analyse with Muse, grounded in sources

A 12-stage DAG with explicit dependencies, streamed live to the reviewer:

| Stage            | What it does                                                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `segment`        | Splits documents into stable passage IDs (`D2.P001`) with offsets and hashes                                                                                                                                          |
| `injection_scan` | Heuristic and model checks for planted instructions; risky passages are quarantined and spotlighted with nonce delimiters                                                                                             |
| `extract`        | Three independent samples (self-consistency) of claims, each citing verbatim quotes                                                                                                                                   |
| `consolidate`    | Clusters claims across samples; agreement becomes a confidence input                                                                                                                                                  |
| `ground`         | Verifies every quote verbatim against the source passage and records exact offsets                                                                                                                                    |
| `verify`         | Judges each claim against its cited and neighbouring passages: supported, contradicted, unsupported                                                                                                                   |
| `temporal`       | Normalises time expressions to intervals and solves a simple temporal network; negative cycles (Floyd-Warshall bounds, Bellman-Ford extraction) become explicit timeline conflicts                                    |
| `entities`       | Union-find over explicit placeholder equivalences, never over guessed identities                                                                                                                                      |
| `contradictions` | Pairs of claims that cannot both be true, with the passages that conflict                                                                                                                                             |
| `calibrate`      | A documented logistic formula over grounding, agreement, verification and source type gives each claim a confidence and an evidence class: documented, corroborated allegation, allegation, contradicted, unsupported |
| `gaps`           | Follow-up questions for the reporter that never ask for identifying details                                                                                                                                           |
| `brief`          | A summary in which every key point cites claims                                                                                                                                                                       |

Every model call uses strict JSON Schema structured output, semantic validation and a bounded repair
loop with salvage, so invalid model output degrades a stage instead of corrupting the result.
Findings are sealed back to the reviewers.

### 5. Pay per analysis, keep payments unlinkable

The analysis endpoint is protected with **x402**: an unpaid request gets HTTP 402 with payment
requirements; the organisation retries with an `X-PAYMENT` header that a facilitator verifies and
settles. Payment records live in their own database and link to jobs only through a keyed HMAC.

### 6. Make every access auditable

Submissions, analyses, access requests, quorum approvals and unlocks are appended to an RFC 9162
Merkle transparency log with Ed25519 signed tree heads, inclusion and consistency proofs, and
periodic anchoring of the root on-chain. Opening original evidence requires signed approvals from a
quorum of reviewers, who re-seal their shares to the requester.

## Repository layout

| Path                | What                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `apps/web`          | Next.js 16 app: reporter flow, reviewer console, inbox, audit, evals, architecture                                     |
| `services/identity` | Hono service: Self verification, nullifier quota, RFC 9474 blind signing                                               |
| `services/api`      | FastAPI: submissions, x402, job queue with leases and dead letters, SSE, quorum, inbox, transparency log               |
| `services/pipeline` | The 12-stage analysis DAG, providers (Meta, Fireworks, Baseten, Claude, Codex, replay, chaos, tap) and the pull worker |
| `services/evals`    | Synthetic scenarios with ground truth, metrics and the provider benchmark                                              |
| `packages/crypto`   | Browser and Node crypto: envelopes, Shamir, blind tokens, codenames, Merkle proofs                                     |
| `packages/privacy`  | Metadata stripping, PII detection, pseudonymisation, leakage scoring                                                   |
| `packages/sdk`      | Typed client and submission builder used by the web app and the demo seeder                                            |
| `infra/modal`       | Modal app: API, identity, analysis workers, scheduled evals                                                            |
| `docs/specs`        | The contracts between services, including exact wire formats and test vectors                                          |

Python and TypeScript interoperate through shared test vectors generated with PyNaCl
(`docs/specs/vectors/protocol-vectors.json`) that both sides must pass.

## Running locally

Requirements: Node 22+, pnpm 10, Python 3.12+ and uv.

```bash
pnpm install
pnpm seed
pnpm dev
```

`pnpm dev` starts identity (8787), the API (8000), the analysis worker and the web app (3000). With
no `NEXT_PUBLIC_API_URL` the web app runs in showcase mode with recorded data.

### Choosing the model

The pipeline routes each stage to a provider (`services/pipeline/router.json`). Set
`CANDOR_LLM_PROVIDER` to `claude` (the default), `meta`, `fireworks`, `baseten`, `codex` or
`replay`. `claude` runs Claude Haiku 5.5 (`CANDOR_CLAUDE_MODEL`) through the Anthropic API when
`ANTHROPIC_API_KEY` is set, and through a signed-in Claude Code CLI otherwise, so a local run needs
no key. With `MODEL_API_KEY` in `.env`, one command runs the evaluation suite against Meta Muse and
then benchmarks Muse, Claude Haiku 5.5, Fireworks and Baseten per stage, regenerating the router and
the `/evals` data:

```bash
pnpm meta
```

`pnpm meta evals` or `pnpm meta bench --repeats 1` runs one half. Providers without credentials are
listed as skipped rather than guessed. Meta runs always call the live API; they never reuse the
recorded cassettes.

## Quality gates

```bash
pnpm check
```

runs Prettier, ESLint (including a rule that forbids comments), TypeScript, Vitest, Ruff, a Python
comment and docstring checker, and pytest for every service.

## Honest limits

- Content and writing style can identify a person; the risk score flags common patterns but cannot
  catch everything.
- The API sees network metadata. Use Tor Browser for the strongest protection.
- An organisation that controls a quorum of reviewer keys can open evidence; that is the design, and
  every opening is logged.
- The model provider's data retention policy applies to the redacted analysis view.
- Mock modes (Self, x402, chain anchoring) are labelled as such wherever they appear.
