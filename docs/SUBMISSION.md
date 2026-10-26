# Submission

Copy for the hackathon form. Every claim is backed by code in this repository; numbers come from
files the harness wrote, never typed in by hand.

## Name

Candor

## Tagline

Say what happened, not who you are.

## One-liner

A zero-knowledge whistleblowing platform where Meta Muse turns scattered, redacted evidence into a
cited, verified timeline reviewers can trust, without anyone learning who reported it.

## Links

- Live demo: https://candor-whistle.vercel.app
- Source: https://github.com/wenshen18643/candor
- Track: Indie

## The problem

People with evidence of wrongdoing stay silent because reporting exposes them: hotlines ask who you
are, files carry author names and GPS tags, and one curious insider can open everything. The
organisations that do receive reports get a pile of emails and screenshots and no way to tell what is
documented from what is merely alleged.

## What it does

1. **Prove you may report without saying who you are.** A Self passport proof shows the reporter is
   a real adult; RFC 9474 blind RSA tokens make the report unlinkable to that verification, and a
   campaign-scoped nullifier caps abuse at three reports a month.
2. **Clean evidence on the device.** PDF, Word, email and image metadata is stripped and re-parsed
   to prove it is gone. Names become consistent placeholders across every file, the reporter's own
   identifiers are always removed, and they approve every redaction.
3. **Seal it so no single party can read it.** XChaCha20-Poly1305 with Padmé padding, the key split
   2-of-3 with Shamir and each share sealed to one reviewer. The server only ever stores ciphertext.
4. **Analyse with Meta Muse, grounded in sources.** A twelve-stage pipeline extracts claims three
   independent times, matches every quote character by character against its passage, verifies each
   claim against only its cited text, solves the timeline as a simple temporal network, finds
   contradictions, calibrates confidence with a fixed formula and writes a brief in which every
   point cites claims. Planted prompt injections are quarantined.
5. **Pay per analysis, unlinkably.** x402: the analysis endpoint answers 402, the organisation pays
   in `X-PAYMENT`, and payments live in a separate database linked to jobs only by an HMAC.
6. **Audit every access.** Opening originals needs signed approvals from a quorum of reviewers, and
   every submission, analysis, request and unlock goes into an RFC 9162 Merkle transparency log
   anyone can verify in the browser.
7. **Talk back anonymously.** An eight-word codename, stretched with Argon2id into inbox keys, lets
   reviewers ask the reporter neutral follow-up questions the pipeline drafted.

## How Meta Muse is used

Every model stage (injection scan, extraction, verification, contradictions, gaps and the brief)
calls the Meta Model API through an OpenAI-compatible client with strict JSON Schema structured
output, semantic validation and a bounded repair loop. A per-stage router picks the provider; the
benchmark measures quality, p50/p95 latency and cost per stage across Meta, Fireworks, Baseten and
Claude Haiku 5.5 and keeps the cheapest within 0.02 of the best quality. While Muse access was
pending, the public demo's Northwind case was recorded with `gpt-6.1-sol` and the evaluation suite
was run on Claude Haiku 5.5; `pnpm meta` reruns the whole evaluation and benchmark on Muse with one
command.

## Does it work

Six synthetic cases (procurement kickback, falsified safety inspections, a concealed patient-data
breach, research fabrication, retaliation and wage theft), each with planted identifiers,
contradictions and date puzzles, four of them with a planted prompt injection. Each runs three
times: as written, with a chaos provider corrupting 30% of model output, and with the
injection removed. The published run used Claude Haiku 5.5 (`/evals`); its 171 model calls are
committed, and replaying them reproduces every number exactly.

- **Privacy:** 0 identifier leaks across the sealed payload, every outbound prompt, file metadata
  and the results.
- **Grounding:** 100% of quotes found verbatim in their source passage; 100% of planted events
  recovered.
- **Timeline:** event order 1.00 Kendall τ-b; resolved dates 0.9 days off on average.
- **Robustness:** 100% of chaos runs still end in a valid result; injections flagged 100%, attack
  success 0%.
- **Not there yet (shown on the page):** claim precision 77%, contradiction recall 50% and temporal
  conflict recall 0%. Haiku rarely writes explicit "this happened after that" links, which the
  temporal solver needs.

## Technical ambition

- Two-way anonymity: blind signatures, scoped nullifiers and three separate databases with no
  shared keys, so identity, reports and payments cannot be joined even if two services collude.
- Threshold custody with Ed25519-signed approvals and browser-side share combination.
- A transparency log with inclusion and consistency proofs and periodic on-chain anchoring.
- Hallucination control by structure: self-consistency, deterministic grounding, an independent
  verifier and a documented logistic confidence formula instead of the model's own opinion.
- Temporal reasoning: dates resolved against each document's own reference date, intervals for
  vague expressions, Floyd-Warshall bounds and Bellman-Ford negative-cycle extraction to name the
  exact claims that cannot all be true.
- A durable job queue with leases, heartbeats, attempt fencing, retries, dead letters and resumable
  server-sent events, runnable on Modal.

## Honest limits

- Writing style and content can still identify someone; the risk meter flags common patterns only.
- The API sees network addresses; Tor Browser gives the strongest protection.
- A quorum of reviewers can open evidence by design; the log makes that visible, not impossible.
- The demo uses mock Self verification, mock x402 settlement and a mock chain, each labelled where
  it appears.

## Built with

Next.js 16, React 19, Tailwind CSS 4, FastAPI, Pydantic 2, Hono, libsodium, RFC 9474 blind RSA,
Self, x402, Modal, Vercel, the Meta Model API, Claude Haiku 5.5 and the Codex CLI.
