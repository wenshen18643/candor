import { EvidenceClassBadge, QuarantineBadge } from "@/components/evidence/badges";
import {
  analysis,
  quarantinedPassage,
  stageDetail,
  stageStats,
  temporalConflict,
  timelineSummary,
} from "@/components/landing/pipeline-data";
import { PipelineExplorer } from "@/components/landing/pipeline-explorer";
import { Badge } from "@/components/ui/badge";
import { stageDependencies, stageMeta, stageOrder } from "@/lib/evidence";
import type { EvidenceClass } from "@/lib/types";

import { MerkleDiagram } from "./diagrams";
import {
  ArchSection,
  C,
  CodeBlock,
  FactList,
  Figure,
  Prose,
  Steps,
  SubHeading,
  WideVisual,
} from "./primitives";

export function PipelineArchSection() {
  return (
    <ArchSection
      id="pipeline"
      summary="Twelve steps turn evidence into a checked timeline. Five are plain code; seven use the AI."
      title="Analysis pipeline"
      lead="A directed acyclic graph of twelve stages, five of them plain code. Independent stages run concurrently; a failed non-critical stage degrades the result instead of failing the job, and invalid model output never reaches the result."
      sources={[
        "docs/specs/04-pipeline.md",
        "services/pipeline/src/candor_pipeline/dag.py",
        "services/pipeline/src/candor_pipeline/stages/",
        "services/pipeline/src/candor_pipeline/temporal/stn.py",
        "services/pipeline/src/candor_pipeline/structured.py",
        "services/pipeline/src/candor_pipeline/router.py",
      ]}
    >
      <PipelineExplorer stats={stageStats()} initial="temporal" />
      <div className="flex flex-col gap-4">
        <SubHeading>Every stage, in order</SubHeading>
        <dl className="flex flex-col divide-y divide-line border-y border-line">
          {stageOrder.map((stage) => {
            const meta = stageMeta[stage];
            const detail = stageDetail[stage];
            const deps = stageDependencies[stage] ?? [];
            return (
              <div
                key={stage}
                className="grid gap-x-6 gap-y-1.5 py-4 sm:grid-cols-[12rem_minmax(0,1fr)]"
              >
                <dt className="flex flex-col items-start gap-1.5">
                  <span className="font-semibold text-ink">{meta?.label ?? stage}</span>
                  <Badge tone={meta?.kind === "llm" ? "seal" : "outline"}>
                    {meta?.kind === "llm" ? "Model call" : "Deterministic"}
                  </Badge>
                </dt>
                <dd className="max-w-[68ch] text-base text-ink-2">
                  {detail.algorithm}
                  <span className="mt-1 block text-xs text-ink-3">
                    {detail.calls}
                    {deps.length
                      ? ` · after ${deps.map((dep) => stageMeta[dep]?.label ?? dep).join(", ")}`
                      : " · first stage"}
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
      <div className="flex flex-col gap-4">
        <SubHeading>Timeline solving, worked</SubHeading>
        <Prose>
          <p>
            Each claim with a time becomes two day-number variables, <C>start</C> and <C>end</C>,
            with <C>start ≤ end</C>, the interval bounds from normalisation, and the links the text
            states: <C>before</C> means <C>end_i ≤ start_j</C>, <C>during</C> means containment,{" "}
            <C>same_time</C> means equal within a day. Written as a distance graph, a set of
            constraints that cannot all hold shows up as a negative cycle.
          </p>
          <p>
            In the demo report the solver placed {timelineSummary.events} events,{" "}
            {timelineSummary.exact} of them to the day, and found{" "}
            {timelineSummary.conflicts === 0
              ? "no constraints that contradict each other"
              : `${timelineSummary.conflicts} set${timelineSummary.conflicts === 1 ? "" : "s"} of constraints that cannot all hold`}
            .
          </p>
        </Prose>
        {temporalConflict ? (
          <div className="rounded-lg bg-surface p-4 sm:p-5">
            <p className="text-base text-ink">{temporalConflict.description}</p>
            <ul className="mt-3 flex flex-col gap-1.5 font-mono text-xs text-ink-2">
              {temporalConflict.constraints.map((constraint) => (
                <li key={constraint}>{constraint}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <Prose>
          <p>
            The cycle is extracted by walking predecessor edges from a Bellman-Ford relaxation,
            reported as a conflict that names each constraint and its passage, and the constraint
            from the weakest source is dropped. The network is solved again, and Floyd–Warshall
            gives every event its tightened interval; the pre-solve interval is kept alongside, so
            reviewers can see what the solver changed.
          </p>
        </Prose>
      </div>
      <div className="flex flex-col gap-4">
        <SubHeading>Calibration</SubHeading>
        <CodeBlock label="Calibration formula">
          {`score = σ(−1.6 + 2.2·agreement + 1.8·v + 0.45·min(sources, 3)
           − 1.2·contradicted − 1.5·injected)

v: supported 1 · partly 0.6 · unverifiable 0 · not supported −0.6 · contradicted −1.2
labels: high ≥ 0.80 · moderate ≥ 0.60 · low ≥ 0.35 · otherwise very low`}
        </CodeBlock>
        <Prose>
          <p>
            <strong>agreement</strong> is the share of the three extraction samples that produced
            the claim, so self-consistency becomes evidence. <strong>sources</strong> counts
            distinct documents with a verified quote; the reporter’s own statement never counts. The
            evidence class then follows fixed rules, checked in order: contradicted, then
            unsupported, then allegation, then corroborated, documented and single source.
          </p>
        </Prose>
      </div>
      <FactList
        items={[
          {
            term: "Structured output",
            detail:
              "JSON Schema comes from the Pydantic stage models. Output is parsed strictly, then validated for types and meaning: every passage and claim it cites must exist, and dates must parse. Up to two repair prompts carry the validation errors back; whatever still fails is dropped, never invented.",
          },
          {
            term: "Providers",
            detail: (
              <>
                One interface, <C>complete_json</C>, over Meta Muse Spark (<C>muse-spark-1.3</C>)
                via the Meta Model API’s OpenAI-compatible endpoint with strict JSON schemas,
                Fireworks, Baseten, Claude Haiku 5.5 (<C>claude-haiku-5-5</C>, through the Anthropic
                API or a signed-in Claude Code CLI), a local Codex CLI, and a record-and-replay
                cassette provider that makes CI deterministic.
              </>
            ),
          },
          {
            term: "Routing",
            detail: (
              <>
                <C>candor-evals bench</C> measures quality, p50 and p95 latency and cost per stage
                and provider, and writes <C>router.json</C> choosing, per stage, the cheapest
                provider within two points of the best quality.
              </>
            ),
          },
        ]}
      />
    </ArchSection>
  );
}

const unsupportedClaim = analysis.claims.find((claim) =>
  claim.flags.includes("cites_injected_passage"),
);

const cleanPassage =
  analysis.passages.find((passage) => passage.passage_id === "D2.P001") ??
  analysis.passages.find((passage) => passage.doc_id !== "S" && passage.injection_risk < 0.7);

function signalText(signal: string) {
  const text = signal.replace(/_/g, " ").replace(/\.$/, "");
  return /\s/.test(text) ? text : `Heuristic match: ${text}`;
}

function wrap(text: string, width = 76) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return [...lines, line].join("\n");
}

export function InjectionSection() {
  return (
    <ArchSection
      id="injection"
      summary="Evidence that tries to give the AI orders is flagged and ignored."
      title="Prompt-injection defence"
      lead="Evidence is data, never instructions. Candor assumes some documents were written to manipulate the analysis, and treats the attempt as a finding in its own right."
      sources={[
        "services/pipeline/src/candor_pipeline/prompts.py",
        "services/pipeline/src/candor_pipeline/stages/injection_scan.py",
        "services/pipeline/src/candor_pipeline/stages/calibrate.py",
      ]}
    >
      <CodeBlock label="Spotlighted evidence as the model receives it">
        {`<<EVIDENCE id="${cleanPassage?.passage_id ?? "D2.P001"}" nonce="7c41e09b">>
${wrap(cleanPassage?.text ?? "")}
<</EVIDENCE nonce="7c41e09b">>

<<EVIDENCE id="${quarantinedPassage?.id ?? "D6.P001"}" nonce="7c41e09b" quarantined="true">>
${wrap(quarantinedPassage?.text ?? "")}
<</EVIDENCE nonce="7c41e09b">>`}
      </CodeBlock>
      <Steps
        items={[
          <>
            <strong>Spotlighting.</strong> Every passage sits inside delimiters carrying a random
            per-run nonce, so a document cannot forge a closing tag. The system prompt states that
            evidence is untrusted and that instructions inside it are findings, not commands.
          </>,
          <>
            <strong>Heuristics.</strong> Regex families for instruction overrides, role switching,
            system-prompt references, output manipulation, tool or URL exfiltration and hidden-text
            markers produce signals and a risk score per passage.
          </>,
          <>
            <strong>Classifier.</strong> One batched model call refines the risk of passages with
            any heuristic signal or imperative, second-person wording.
          </>,
          <>
            <strong>Quarantine.</strong> At a risk of 0.7 or more a passage is quarantined: still
            shown to reviewers, marked for the model, and unable to support a claim alone. A claim
            resting only on quarantined text is flagged <C>cites_injected_passage</C>, classed
            unsupported, and loses 1.5 in the calibration logit.
          </>,
        ]}
      />
      {quarantinedPassage && unsupportedClaim ? (
        <div className="flex flex-col gap-3 rounded-lg bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <QuarantineBadge />
            <span className="font-mono text-xs text-ink-2">
              {quarantinedPassage.id} · risk {quarantinedPassage.risk.toFixed(2)}
            </span>
          </div>
          <div className="text-sm text-ink-2">
            <p>What the scan found:</p>
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
              {quarantinedPassage.signals.map((signal) => (
                <li key={signal}>{signalText(signal)}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <p className="text-sm text-ink">
              A claim that rests only on this passage,{" "}
              <span className="font-mono">{unsupportedClaim.claim_id}</span>: “
              {unsupportedClaim.statement}”
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
              <EvidenceClassBadge value={unsupportedClaim.evidence_class as EvidenceClass} />
              confidence {unsupportedClaim.confidence?.score.toFixed(2)}, kept out of the brief.
            </div>
          </div>
        </div>
      ) : null}
      <Prose>
        <p>
          <strong>Limits.</strong> Heuristics and a classifier reduce the risk; they do not remove
          it. An injection that scores below the threshold can still colour wording. Verbatim
          grounding, a separate verifier that sees only cited text, and per-claim citations limit
          how far it can travel, and the evaluation measures attack success rather than assuming it
          is zero.
        </p>
      </Prose>
    </ArchSection>
  );
}

const entryTypes = [
  "report.submitted",
  "report.status_changed",
  "analysis.requested",
  "analysis.completed",
  "findings.opened",
  "access.requested",
  "access.approved",
  "access.granted",
  "evidence.fetched",
  "message.sent",
  "anchor.published",
];

export function TransparencySection() {
  return (
    <ArchSection
      id="transparency"
      summary="Every action is logged in public, and anyone can check the log was never changed."
      title="Transparency log"
      lead="Every submission, analysis, opening, fetch, approval and message is appended to a public, append-only Merkle log. Anyone can check that an entry is in it and that the log has only grown."
      sources={[
        "docs/specs/01-protocols.md",
        "services/api/src/candor_api/audit.py",
        "services/api/src/candor_api/merkle.py",
        "services/api/src/candor_api/integrations.py",
        "packages/crypto/src/merkle.ts",
      ]}
    >
      <Figure
        mode="always"
        visual={
          <WideVisual label="Merkle tree diagram">
            <MerkleDiagram />
          </WideVisual>
        }
        alternative={
          <ul className="flex flex-col gap-2.5 text-sm text-ink-2">
            <li>
              Seven entries, d0 to d6. RFC 9162 splits at the largest power of two below the size,
              so the root is the hash of the subtree over d0–d3 and the subtree over d4–d6.
            </li>
            <li>
              Inclusion proof for entry 5: the hash of d4, the hash of d6, and the root of d0–d3.
              Three hashes rebuild the root.
            </li>
            <li>
              Consistency proof from size 4 to size 7: the root of d4–d6. With it, anyone holding
              the size-4 root can check that the size-7 tree extends it without rewriting it.
            </li>
          </ul>
        }
        caption="Seal marks the inclusion proof for entry 5 and the path it recomputes. Blue marks the single hash that proves the size-7 tree extends the size-4 tree."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <SubHeading>Hashing and tree heads</SubHeading>
          <CodeBlock label="Merkle hashing and signed tree head">
            {`leaf_hash(d)    = SHA-256(0x00 ‖ d)
node_hash(l, r) = SHA-256(0x01 ‖ l ‖ r)

{ "tree_size": 42, "root_hash": "<hex>",
  "timestamp": "2026-10-26T10:00:00Z",
  "key_id": "<hex>", "signature": "<b64u>" }

signed: "candor/v1/sth\\n" + size + "\\n"
        + root_hash + "\\n" + timestamp`}
          </CodeBlock>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <SubHeading>What an entry can contain</SubHeading>
          <ul className="flex flex-wrap gap-1.5">
            {entryTypes.map((type) => (
              <li key={type}>
                <code className="inline-block rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink">
                  {type}
                </code>
              </li>
            ))}
          </ul>
          <Prose>
            <p>
              Only IDs, hashes, statuses and hour buckets. Never ciphertext, message bodies or
              names: each entry type has a fixed field set in <C>audit.py</C>, and an entry with any
              other field is rejected before it is appended.
            </p>
          </Prose>
        </div>
      </div>
      <FactList
        items={[
          {
            term: "Signing",
            detail:
              "A new Ed25519-signed tree head after every append. Inclusion and consistency proofs are served under /v1/log/proofs, and verifyInclusion and verifyConsistency in @candor/crypto check them in any browser.",
          },
          {
            term: "Anchoring",
            detail:
              "Every 16 entries, and on demand, the root is published as calldata in a zero-value self-transaction on Base Sepolia. Demo mode records a deterministic mock reference instead.",
          },
          {
            term: "What it does not stop",
            detail:
              "An operator could show different logs to different people. Signed tree heads make that provable once two views are compared, and anchors give a shared reference, but nothing yet gossips tree heads between independent monitors.",
          },
        ]}
      />
    </ArchSection>
  );
}
