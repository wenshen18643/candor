# Submission

Copy for the hackathon form. Every claim is backed by code in this repository; numbers come from
files the harness wrote, never typed in by hand.

## Name

Candor

## Tagline

Say what happened, not who you are.

## One-liner

A zero-knowledge whistleblowing platform where Muse Spark Open, Meta's open-weights model, turns
scattered, redacted evidence into a cited, verified timeline reviewers can trust, without anyone
learning who reported it.

## Links

- Live demo: https://candor-whistle.vercel.app
- Source: https://github.com/wenshen18643/candor
- Track: Indie

## The problem

Insiders are how wrongdoing gets found: in the ACFE's 2024 _Report to the Nations_ (1,921 cases), 43%
of occupational frauds were detected by a tip, more than by any other method, and over half of those
tips came from employees. But reporting exposes the person who does it: hotlines ask who you are,
files carry author names and GPS tags, and one curious insider can open everything. The
organisations that do receive reports get a pile of emails and screenshots and no way to tell what is
documented from what is merely alleged.

It is also not optional. The EU Whistleblower Directive (2019/1937) requires every private employer
with 50 or more workers to run a confidential internal reporting channel, acknowledge each report
within seven days and give the reporter feedback within three months. Candor's anonymous inbox is how
a reviewer gives that feedback without ever learning who to send it to.

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

Muse Spark Open does every model step: the injection scan, three independent extraction passes, the
verifier, entity links, contradictions, follow-up questions and the brief. It runs on Baseten
(`meta-models/muse-spark-open-1026`) through an OpenAI-compatible client.

- **Open weights are the point.** Whistleblowing evidence is the last thing an organisation wants
  to send to a third party. Because Muse Spark Open's weights are public, the same pipeline can run
  on the organisation's own hardware; the hosted endpoint is a convenience, not a dependency.
- **Built around the model's quirks.** Baseten does not enforce JSON schemas for Muse Spark Open, so
  the schema travels in the prompt and Candor's validator, repair loop and salvage enforce it. Muse
  always reasons; its reasoning comes back in a separate field, gets its own token budget and never
  reaches the result.
- **Checked, not trusted.** Every quote Muse cites is matched character by character against its
  passage, a second Muse pass verifies each claim against only its cited text, and confidence comes
  from a fixed formula rather than the model's opinion.
- **Measured.** The Northwind showcase ran on Muse in 59 seconds for $0.16 with 35 of 35 quotes
  verified and zero schema repairs; the six-case evaluation below ran on Muse too, and every model
  call of both is committed so the numbers replay offline.

The same client reaches Muse Spark on the Meta Model API and Muse Spark Open on Fireworks. A
per-stage benchmark against Claude Haiku 5.5 (three cases, two repeats) found Muse level on
extraction (0.88 vs 0.89 F1), ahead on verification (it confirmed 100% of documented events against
64%) and behind on follow-up questions (0.67 vs 0.83 coverage). The router only routes to
open-weights models, so every stage runs on Muse; Haiku is published as the reference.

## Does it work

Six synthetic cases (procurement kickback, falsified safety inspections, a concealed patient-data
breach, research fabrication, retaliation and wage theft), each with planted identifiers,
contradictions and date puzzles, four of them with a planted prompt injection. Each runs three
times: as written, with a chaos provider corrupting 30% of model output, and with the injection
removed. The published run used Muse Spark Open (`/evals`): 114 model calls for $1.88, all
committed, and replaying them reproduces every number exactly.

- **Privacy:** 0 identifier leaks across the sealed payload, every outbound prompt, file metadata
  and the results.
- **Grounding:** 100% of quotes found verbatim in their source passage; 100% of planted events
  recovered; 83% of claims match a planted fact (Claude Haiku 5.5 on the same cases: 77%).
- **Timeline:** event order 1.00 Kendall τ-b; resolved dates 0.7 days off on average (Haiku: 0.9).
- **Robustness:** 100% of chaos runs still end in a schema-valid result; injections flagged 100%,
  attack success 0%.
- **Live:** a report sealed in the browser, paid for over x402 and analysed by the worker on Muse
  runs all twelve stages in about a minute.
- **Not there yet (shown on the page):** contradiction recall 17% and temporal conflict recall 0%.
  The planted conflicts are timing ones ("released after the review", in a register dated before
  the review). Muse writes the "after" link in some samples and keeps the date in others, but the
  solver needs both in the same claim; merging links and dates across samples is the next step.

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
Self, x402, Modal, Vercel, Muse Spark Open on Baseten, the Meta Model API and Claude Haiku 5.5 as
the benchmark baseline.
