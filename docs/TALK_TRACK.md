# Talk track

A guide for presenting Candor to judges: a three-minute demo, then the technical depth to draw on
when they ask questions. Every claim here is backed by code in this repository; the file to point
at is given in brackets.

## The one-liner

Candor: say what happened, not who you are. A zero-knowledge whistleblowing platform where Meta
Muse turns scattered evidence into a cited, verified timeline reviewers can trust.

## The problem in two sentences

People with evidence of wrongdoing stay silent because reporting exposes them: hotlines ask for
details, files carry author names and GPS tags, and a single curious insider can open everything.
Organisations that do receive reports get a pile of emails and screenshots, and no way to tell what
is documented from what is alleged.

## Three-minute demo

1. **Landing page (20 s).** "Everything in this panel is real cryptography running in this tab: the
   email is encrypted with XChaCha20-Poly1305, the key is split two-of-three with Shamir, each share
   is sealed to a reviewer, and two shares rebuild it." Point at the byte sizes and the visibility
   matrix.
2. **Report (60 s).** Open `/report/northwind-ethics`.
   - Test passport A: "That was an RFC 9474 blind signature. The issuer signed three tokens it has
     never seen, so it cannot link this verification to the report."
   - Use sample evidence, Clean and review: "That PDF just lost its Author and Creator fields, the
     Word file 27 hidden properties, the emails their originating IP. Names became consistent code
     names across every file. My own name and team are always removed."
   - Seal and send: read two lines of the live log, then show the eight-word codename.
3. **Reviewer console (60 s).** Sign in as Avery Chen and open the Northwind report.
   - Pipeline tab: twelve stages, which ran on the model and which are plain code.
   - Brief, then click a claim: the quote, its exact character offsets, the verifier's verdict and the
     confidence formula. "Every sentence traces to a verbatim source. Nothing is paraphrased into
     existence."
   - Timeline: the red conflict. "The minutes say the meeting was on the 10th; the reporter's chat
     says the score changed on the 6th, before a meeting that the email says was due on the 3rd. We
     solve this as a constraint network and the negative cycle names the statements that cannot all
     be true."
   - Injection badge on the cover letter: "This PDF tells the model to ignore its instructions. It
     was quarantined, and it cannot support a claim on its own."
   - Evidence tab: request access, approve as Morgan: "Two of three reviewers must agree to open the
     originals, and the opening goes into a public log."
4. **Transparency log (20 s).** `/audit`: Run all checks, then Tamper with this entry: the proofs fail.
5. **Close (20 s).** `/evals`: the leakage and grounding numbers on synthetic cases, measured, not
   asserted.

## Questions judges ask, and the deep answer

**How do you know who is reporting is real, without knowing who they are?**
Self proves passport authenticity and age in zero knowledge on the phone. The identity service gets
a nullifier scoped to the campaign and stores only HMAC(secret, campaign | epoch | nullifier), so
quotas work (three tokens per 30 days) but tags cannot be compared across campaigns or epochs
[`services/identity/src/service.ts`]. It then blind-signs tokens; the API verifies RSA-PSS
signatures over tokens the identity service never saw [`packages/crypto/src/blind.ts`,
`services/api/src/candor_api/reports.py`]. Even if both services collude, the token cannot be matched
to the verification.

**What stops the server reading evidence?**
It only ever holds ciphertext. A random report key encrypts each file with XChaCha20-Poly1305, with
associated data binding the ciphertext to its report and purpose, after Padmé padding. The key is
Shamir-split k-of-n and each share is sealed (crypto_box_seal) to one reviewer. The analysis view is
encrypted under a separate key sealed to the worker [`docs/specs/01-protocols.md`].

**What stops one reviewer opening everything?**
Threshold custody. Opening needs a quorum: each approver signs an Ed25519 approval and re-seals their
share to the requester, whose browser combines them. Every request, approval and unlock is a
transparency log entry.

**Why should anyone trust your log?**
It is an RFC 9162 Merkle tree with Ed25519 signed tree heads. Clients verify inclusion proofs for
their own receipt and consistency proofs between heads they have seen, so the operator cannot
rewrite history without detection; roots are anchored on-chain every 16 entries
[`services/api/src/candor_api/merkle.py`, `apps/web/src/components/audit`].

**How do you stop the model making things up?**
Structure, not hope. Three independent extraction samples (self-consistency) must cite verbatim
quotes; a deterministic grounding stage matches every quote character by character against its
passage; a separate verifier judges each claim only against its cited text; confidence is a fixed,
documented logistic formula over grounding, agreement, verification and source type, not the
model's own opinion; and evidence classes come from rules [`services/pipeline/src/candor_pipeline/stages`].

**What about prompt injection in the evidence?**
Spotlighting: every passage is wrapped in delimiters carrying a per-run random nonce, and the system
prompt says text inside them is data. Heuristics plus a classifier score each passage; anything at
0.7 or above is quarantined and cannot support a claim alone. The evals plant instructions and check
that the brief never obeys them.

**What if the model returns garbage?**
Strict JSON Schema structured output, Pydantic validation, semantic checks (no references to passages
that do not exist), a bounded repair loop that feeds back only error paths, then salvage. The chaos
provider injects malformed output during evaluation to prove the stage degrades instead of
corrupting the result. If one of the three extraction samples is lost, the stage degrades to two.

**How is the timeline checked?**
Every date and every before/after relation becomes an edge in a simple temporal network over day
numbers. Floyd-Warshall gives the tightest bounds; a negative cycle means the statements cannot all
be true, and Bellman-Ford extracts the cycle so the conflict names the exact claims and passages
[`services/pipeline/src/candor_pipeline/temporal/stn.py`].

**Where does Meta Muse come in?**
Every model stage runs on the Meta Model API (Muse Spark) through an OpenAI-compatible client with
strict structured output. A per-stage router chooses the provider; the benchmark measures quality,
p50/p95 latency and cost per stage across Meta, Fireworks and Baseten and keeps the cheapest provider
within 0.02 of the best quality [`services/evals`, `services/pipeline/router.json`].

**How do organisations pay?**
x402: the analysis endpoint returns 402 with payment requirements; the organisation's wallet signs
an EIP-3009 authorisation sent in `X-PAYMENT`, a facilitator verifies and settles USDC on Base. The
payments database is separate and linked to jobs only by an HMAC, so the payment trail never touches
the reporter [`services/api/src/candor_api/payments.py`].

**How does it scale?**
Analysis jobs sit in a durable queue with ten-minute leases that the worker renews with a heartbeat,
retries and a dead-letter queue. Every write from a worker carries its attempt number, so a worker
that lost its lease cannot overwrite the result of the one that replaced it
[`services/api/src/candor_api/jobs.py`]. Workers pull jobs, so they can run anywhere, including
Modal functions spawned on enqueue with retries and timeouts [`infra/modal/app.py`]. Stage events
stream to the browser over resumable SSE.

## Honest limits (say them before they are asked)

- Writing style and content can still identify someone; the risk meter flags common patterns only.
- The API sees network addresses; Tor is recommended for the strongest protection.
- A quorum of reviewers can open evidence by design; the log makes that visible, not impossible.
- Demo mode uses mock Self, mock x402 settlement and a mock chain; each is labelled where it
  appears.
