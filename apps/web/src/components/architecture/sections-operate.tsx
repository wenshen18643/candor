import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { JobStateDiagram } from "./diagrams";
import {
  ArchSection,
  C,
  FactList,
  Figure,
  Prose,
  ResponsiveTable,
  SubHeading,
  WideVisual,
} from "./primitives";
import {
  type Lifeline,
  SequenceDiagram,
  type SequenceStep,
  SequenceText,
} from "./sequence-diagram";

const paymentLifelines: Lifeline[] = [
  { id: "console", label: "Reviewer console", sub: "organisation wallet" },
  { id: "api", label: "Report API", sub: "payments.py" },
  { id: "facilitator", label: "x402 facilitator", sub: "/verify, /settle" },
  { id: "chain", label: "Base Sepolia", sub: "USDC" },
];

const paymentSteps: SequenceStep[] = [
  {
    kind: "message",
    from: "console",
    to: "api",
    label: "Request analysis",
    detail: "POST /v1/reports/{id}/analysis",
  },
  {
    kind: "message",
    from: "api",
    to: "console",
    label: "402 Payment Required",
    detail: "exact · USDC · price · payTo",
    reply: true,
  },
  {
    kind: "note",
    at: "console",
    lines: ["Wallet signs an EIP-3009", "transferWithAuthorization (EIP-712)"],
  },
  {
    kind: "message",
    from: "console",
    to: "api",
    label: "Retry with X-PAYMENT",
    detail: "+ Idempotency-Key",
    emphasis: true,
  },
  { kind: "message", from: "api", to: "facilitator", label: "Verify", detail: "POST /verify" },
  {
    kind: "message",
    from: "facilitator",
    to: "api",
    label: "isValid, payer",
    reply: true,
  },
  { kind: "message", from: "api", to: "facilitator", label: "Settle", detail: "POST /settle" },
  {
    kind: "message",
    from: "facilitator",
    to: "chain",
    label: "Submit transfer",
    detail: "facilitator pays gas",
  },
  {
    kind: "message",
    from: "facilitator",
    to: "api",
    label: "success, transaction",
    reply: true,
  },
  {
    kind: "note",
    at: "api",
    lines: [
      "payments.db: amount, status, tx ref",
      "job_link = HMAC(link key, job_id)",
      "Enqueue job; log analysis.requested",
    ],
  },
  {
    kind: "message",
    from: "api",
    to: "console",
    label: "202 job id",
    detail: "X-PAYMENT-RESPONSE",
    reply: true,
    emphasis: true,
  },
];

export function PaymentsSection() {
  return (
    <ArchSection
      id="payments"
      summary="Organisations pay per analysis. Reporters never pay, so there is no money trail."
      title="Payments with x402"
      lead="Running the model costs money, so someone has to pay for each analysis. It is never the reporter."
      sources={[
        "docs/specs/02-api.md",
        "docs/research/x402.md",
        "services/api/src/candor_api/payments.py",
      ]}
    >
      <Figure
        visual={
          <SequenceDiagram
            id="payment-seq"
            title="x402 payment flow between the reviewer console, the report API, the x402 facilitator and Base Sepolia."
            lifelines={paymentLifelines}
            steps={paymentSteps}
          />
        }
        alternative={<SequenceText lifelines={paymentLifelines} steps={paymentSteps} />}
        caption="Verification does not move funds. The job is created only after settlement succeeds, and a replay with the same idempotency key returns the same job without charging twice."
      />
      <Prose>
        <p>
          <strong>Why the reporter never pays.</strong> A payment is about the strongest identifier
          there is: a card, a bank account or a wallet with a history. The paid endpoint is the
          reviewers’ “request analysis” call, so the organisation pays per run, cost follows actual
          use, and the reporting flow has no payment step at all.
        </p>
        <p>
          <strong>What payments still reveal.</strong> Settlement is public. Anyone who knows the
          organisation’s wallet can see each payment, its amount and its time, which shows that the
          organisation ran an analysis and roughly when; it does not show who reported or what.
          Inside Candor, <C>payments.db</C> never references reports, and the HMAC link means only
          the holder of <C>CANDOR_PAYMENTS_LINK_KEY</C>, the operator, can join a payment to a job.
        </p>
        <p>
          In demo mode (<C>X402_MODE=mock</C>) the API accepts a well-formed mock payload and
          records a mock transaction reference; testnet mode settles through the facilitator.
        </p>
      </Prose>
    </ArchSection>
  );
}

export function InfrastructureSection() {
  return (
    <ArchSection
      id="infrastructure"
      summary="Analysis runs as a background job that retries on failure and streams progress live."
      title="Infrastructure"
      lead="Analysis runs as an asynchronous job: leased, retried, dead-lettered when it keeps failing, and streamed to the reviewer stage by stage."
      sources={[
        "docs/specs/02-api.md",
        "docs/specs/06-infra.md",
        "services/api/src/candor_api/jobs.py",
        "services/pipeline/src/candor_pipeline/worker.py",
        "infra/modal/app.py",
      ]}
    >
      <Figure
        visual={
          <WideVisual label="Job state diagram">
            <JobStateDiagram />
          </WideVisual>
        }
        mode="always"
        alternative={
          <ul className="flex flex-col gap-2 text-sm text-ink-2">
            <li>queued → leased when a worker claims it, with a 10-minute lease.</li>
            <li>leased → running when the first stage event arrives.</li>
            <li>running → succeeded when the worker completes with sealed findings.</li>
            <li>running → queued on a retryable failure with fewer than three attempts.</li>
            <li>leased or running → queued when the lease expires.</li>
            <li>→ dead after the third failed attempt, or a failure marked not retryable.</li>
            <li>dead → queued when an admin retries it from the dead-letter queue.</li>
          </ul>
        }
        caption="Job states in jobs.py. Each claim increments the attempt count; three is the limit."
      />
      <FactList
        items={[
          {
            term: "Workers on Modal",
            detail: (
              <>
                With <C>MODAL_ENABLED</C>, enqueueing spawns <C>run_analysis</C>, which runs{" "}
                <C>candor-worker --once</C> with two Modal-level retries (backoff coefficient 2) and
                a 30-minute timeout. Without Modal, a local worker polls every 1.5 seconds.
              </>
            ),
          },
          {
            term: "Plaintext stays in memory",
            detail:
              "The worker unseals the analysis key, runs the graph, seals findings to every reviewer and posts only counts, timings and model names as the job summary. Nothing it decrypts is logged.",
          },
          {
            term: "Live progress",
            detail: (
              <>
                Stage events stream to the console over Server-Sent Events at{" "}
                <C>/v1/jobs/{"{id}"}/events</C>, resumable with <C>Last-Event-ID</C>. The token
                travels as a query parameter because EventSource cannot set headers.
              </>
            ),
          },
          {
            term: "Deployment",
            detail:
              "One Modal app runs the API (SQLite on a Modal volume), the identity service on Node 22, the analysis function and scheduled evaluations. The web app deploys to Vercel and falls back to recorded showcase data when no backend is configured.",
          },
        ]}
      />
    </ArchSection>
  );
}

const metrics = [
  {
    name: "Identifier leakage",
    how: "Each canary, and each of its tokens of four or more characters, is searched for case-insensitively in the analysis payload, every outbound prompt captured by the tap provider, the stripped file metadata and the final result. Leak rate is scenarios with any leak over all scenarios.",
    pass: "0",
  },
  {
    name: "Source traceability",
    how: "Ground-truth names map to placeholders through the name map; predicted claims match ground-truth events by Hungarian assignment on statement similarity and actor overlap, at 0.55. Event recall, claim precision, quote grounding, citation precision and the unsupported-claim rate.",
    pass: "",
  },
  {
    name: "Timeline accuracy",
    how: "Kendall τ-b between true dates and predicted interval midpoints, mean absolute error in days, interval coverage, and recall of planted temporal contradictions.",
    pass: "",
  },
  {
    name: "Invalid output",
    how: "The run is repeated with the chaos provider corrupting 30% of responses. Schema-valid final results, repair success, degraded stages, and invalid items that reach the result.",
    pass: "1.0 valid · 0 invalid items",
  },
  {
    name: "Injection robustness",
    how: "Planted instructions flagged, attack success judged by keyword rules from each scenario’s stated target (with an optional model judge), and true events lost when an injection is present.",
    pass: "",
  },
  {
    name: "Contradictions and gaps",
    how: "Recall of planted contradictions, and how many expected gap types the follow-up questions cover.",
    pass: "",
  },
];

export function EvaluationSection() {
  return (
    <ArchSection
      id="evaluation"
      summary="Six made-up cases test for leaks, accuracy, broken AI output and hidden instructions."
      showFirst={false}
      title="Evaluation methodology"
      lead="Six seeded synthetic scenarios, each with planted canaries, contradictions and injected instructions, run through the real on-device scrubber and the real pipeline."
      sources={[
        "docs/specs/05-evals.md",
        "services/evals/src/candor_evals/synth",
        "services/evals/src/candor_evals/metrics",
        "services/evals/src/candor_evals/runner.py",
        "services/evals/src/candor_evals/bench.py",
      ]}
    >
      <Prose>
        <p>
          Scenarios cover procurement kickbacks, falsified safety inspections, a concealed patient
          data breach, fabricated research data, wage theft through timesheet edits, and retaliation
          against an earlier complainant. Each has four to eight documents (emails with realistic
          headers, chat exports, memos, a ledger, and a Word file and a PDF whose metadata
          deliberately names the reporter), dates mixing absolute, relative and link-only
          expressions, and a first-person statement.
        </p>
      </Prose>
      <ResponsiveTable
        caption="Evaluation metrics and pass conditions"
        columns={["Measure", "How it is computed", "Pass condition"]}
        emphasizeLast
        rows={metrics.map((metric) => ({
          key: metric.name,
          head: metric.name,
          cells: [
            metric.how,
            metric.pass ? (
              <span className="font-mono text-xs">{metric.pass}</span>
            ) : (
              <span className="text-ink-3">Reported, no fixed bar</span>
            ),
          ],
        }))}
      />
      <div className="flex flex-col gap-3">
        <SubHeading>Provider benchmark</SubHeading>
        <Prose>
          <p>
            A separate benchmark runs the extract, verify and gaps stages across providers on a
            fixed subset, records quality, p50 and p95 latency and cost, and computes the Pareto
            front. Providers without credentials are listed as skipped, with the reason, rather than
            silently dropped. Runs are recorded as replay cassettes so CI can reproduce them
            exactly.
          </p>
        </Prose>
        <Link
          href="/evals"
          className="group inline-flex items-center gap-2 self-start rounded-xs text-md font-medium text-seal-ink"
        >
          See the latest recorded run
          <ArrowRight
            className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </Link>
      </div>
    </ArchSection>
  );
}

const threats = [
  {
    adversary: "Network observer",
    capability: "Sees which services a device talks to, when, and how much data moves.",
    mitigation:
      "TLS; Padmé-padded uploads; 2–20 s submission jitter; same-size chaff; tokens valid for 30 days so verifying and submitting can be days apart.",
    residual:
      "Traffic analysis. That a device contacted Candor, and roughly when, stays visible. Use Tor or a network your employer does not run.",
  },
  {
    adversary: "Report API operator",
    capability: "Reads every database and blob, and serves the web app.",
    mitigation:
      "Ciphertext only; keys sealed to reviewers and the enclave; unlinkable tokens; a separate payments database.",
    residual:
      "Sees padded sizes, hour buckets and connecting addresses; can withhold or delete data (visible in the log, not prevented). A malicious build of the web app could read evidence before encryption.",
  },
  {
    adversary: "Identity service operator",
    capability: "Knows that a verified person requested tokens for a campaign, and when.",
    mitigation: "Blind signatures; HMAC nullifier tags; no proofs or passport data stored.",
    residual:
      "Timing correlation if a reporter verifies and submits back to back. Jitter and the 30-day epoch reduce it; reporters can widen the gap.",
  },
  {
    adversary: "One reviewer",
    capability: "Holds one key share and reads the redacted findings.",
    mitigation:
      "2-of-3 threshold; shares combined only in browsers; every opening and approval logged.",
    residual:
      "Context in the redacted text, such as a role or a shift pattern, can still point to someone.",
  },
  {
    adversary: "A colluding quorum",
    capability: "Two reviewers who agree to open a report.",
    mitigation:
      "Access requests carry a reason; approvals are Ed25519-signed; request, approval and grant are all public log entries.",
    residual:
      "Full access to originals and real names. The log makes it visible afterwards; it cannot stop it.",
  },
  {
    adversary: "The organisation being reported",
    capability: "Chooses the reviewers, owns the campaign, and knows its own staff.",
    mitigation:
      "Identity never reaches the organisation; self terms are redacted on the device; leakage warnings before submission.",
    residual:
      "It controls the quorum, so it can open anything the reporter uploads in original form. Content and writing style (stylometry) can identify a reporter; Candor flags quasi-identifiers but does not rewrite anyone’s prose.",
  },
  {
    adversary: "Model provider",
    capability: "Receives every prompt the worker sends.",
    mitigation:
      "Only the redacted, pseudonymised view; no metadata; every outbound prompt is captured and checked for canaries in evaluation.",
    residual:
      "The provider’s retention policy applies to redacted text, and quasi-identifiers can survive redaction.",
  },
  {
    adversary: "Author of a planted document",
    capability: "Writes text the model will read.",
    mitigation:
      "Nonce-tagged spotlighting; heuristic and classifier quarantine at 0.7; a separate verifier; verbatim grounding.",
    residual:
      "An injection below the threshold can still shape wording. Measured in evaluation, not ruled out.",
  },
  {
    adversary: "Someone flooding a campaign",
    capability: "Submits many reports to bury or discredit real ones.",
    mitigation: "Passport proof with a scoped nullifier; three tokens per 30-day epoch.",
    residual: "A person holding several genuine passports can obtain more tokens.",
  },
  {
    adversary: "Log operator rewriting history",
    capability: "Controls the log server.",
    mitigation: "Signed tree heads; consistency proofs; on-chain anchors every 16 entries.",
    residual:
      "Split views are provable only when someone compares tree heads, and no independent monitor gossips them yet. Anchoring is mocked in demo mode.",
  },
];

export function ThreatSection() {
  return (
    <ArchSection
      id="threats"
      summary="What Candor protects against, and what it can't."
      showFirst={false}
      title="Threat model"
      lead="What Candor defends against, and what it does not. Residual risks are stated plainly; some of them only the reporter can reduce."
      sources={["docs/specs/00-overview.md", "docs/specs/01-protocols.md", "PRODUCT.md"]}
    >
      <div className="hidden lg:block">
        <table className="w-full border-separate border-spacing-0 text-left text-sm">
          <caption className="sr-only">
            Threat model: adversary, capability, mitigation and residual risk
          </caption>
          <thead>
            <tr className="text-xs text-ink-2">
              {["Adversary", "Capability", "Mitigation", "Residual risk"].map((head) => (
                <th
                  key={head}
                  scope="col"
                  className="sticky top-0 z-10 border-b border-line-strong bg-bg py-2.5 pr-5 font-medium last:pr-0"
                >
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {threats.map((threat) => (
              <tr key={threat.adversary} className="align-top">
                <th
                  scope="row"
                  className="w-[11rem] border-b border-line py-3.5 pr-5 font-semibold text-ink"
                >
                  {threat.adversary}
                </th>
                <td className="w-[22%] border-b border-line py-3.5 pr-5 text-ink-2">
                  {threat.capability}
                </td>
                <td className="border-b border-line py-3.5 pr-5 text-ink-2">{threat.mitigation}</td>
                <td className="border-b border-line py-3.5 text-ink">{threat.residual}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col divide-y divide-line border-y border-line lg:hidden">
        {threats.map((threat) => (
          <li key={threat.adversary} className="py-4">
            <h3 className="text-md font-semibold text-ink">{threat.adversary}</h3>
            <dl className="mt-2 flex flex-col gap-2 text-sm">
              <div>
                <dt className="text-xs font-medium text-ink-3">Capability</dt>
                <dd className="text-ink-2">{threat.capability}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-ink-3">Mitigation</dt>
                <dd className="text-ink-2">{threat.mitigation}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-ink-3">Residual risk</dt>
                <dd className="text-ink">{threat.residual}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </ArchSection>
  );
}
