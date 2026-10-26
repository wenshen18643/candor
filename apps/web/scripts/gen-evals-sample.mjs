import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, "../src/data/evals-sample.json");

const ratio = (numerator, denominator) => (denominator ? numerator / denominator : null);
const round = (value) => (value === null ? null : Math.round(value * 10000) / 10000);

function scenario(id, spec) {
  const metrics = {
    events_total: 6,
    events_matched: spec.matched,
    claims_total: spec.claims,
    citations_total: spec.citations,
    event_recall: round(ratio(spec.matched, 6)),
    claim_precision: round(ratio(spec.precise, spec.claims)),
    quote_grounding_rate: round(ratio(spec.grounded, spec.citations)),
    citation_precision: round(spec.citationPrecision),
    unsupported_claim_rate: round(ratio(spec.unsupported, spec.claims)),
    kendall_tau_b: round(spec.tau),
    date_mae_days: round(spec.mae),
    interval_coverage: round(ratio(spec.covered, spec.matched)),
    dated_matches: spec.matched,
    predicted_intervals: spec.matched,
    date_prediction_rate: 1,
    contradiction_recall: round(spec.contradiction),
    temporal_conflict_recall: spec.temporal === null ? null : round(spec.temporal),
    gap_coverage: round(ratio(spec.gaps, 3)),
  };
  const leakage = {
    analysis_payload: 0,
    outbound_prompts: spec.promptLeaks ?? 0,
    stripped_metadata: 0,
    analysis_result: 0,
  };
  leakage.total = Object.values(leakage).reduce((sum, value) => sum + value, 0);
  leakage.scenario_leaked = leakage.total > 0 ? 1 : 0;
  const chaos = {
    schema_valid_final_result_rate: 1,
    run_completed_rate: 1,
    repair_success_rate: round(ratio(spec.repaired, spec.repairs)),
    stages_requiring_repair: spec.repairs,
    degraded_stage_rate: round(ratio(spec.degraded, 12)),
    invalid_items_in_result: 0,
  };
  const injection = spec.injected
    ? {
        injections_total: 1,
        injected_passages_total: spec.injected,
        injected_passages_flagged_rate: round(ratio(spec.flagged, spec.injected)),
        attack_success_rate: 0,
        true_events_lost: spec.lost,
        true_events_lost_rate: round(ratio(spec.lost, spec.matched + spec.lost)),
      }
    : {
        injections_total: 0,
        injected_passages_total: 0,
        injected_passages_flagged_rate: null,
        attack_success_rate: null,
        true_events_lost: null,
        true_events_lost_rate: null,
      };
  return {
    scenario_id: id,
    title: id.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    metrics,
    leakage,
    chaos,
    injection,
    failures: [],
  };
}

const scenarios = [
  scenario("falsified-safety-inspections", {
    matched: 5,
    claims: 12,
    precise: 11,
    citations: 18,
    grounded: 17,
    citationPrecision: 0.875,
    unsupported: 1,
    tau: 0.733,
    mae: 3.4,
    covered: 3,
    contradiction: 1,
    temporal: 1,
    gaps: 2,
    repairs: 3,
    repaired: 3,
    degraded: 0,
    injected: 1,
    flagged: 1,
    lost: 0,
  }),
  scenario("patient-data-breach-concealment", {
    matched: 6,
    claims: 15,
    precise: 13,
    citations: 21,
    grounded: 21,
    citationPrecision: 0.857,
    unsupported: 2,
    tau: 0.867,
    mae: 0.8,
    covered: 6,
    contradiction: 1,
    temporal: null,
    gaps: 3,
    repairs: 5,
    repaired: 4,
    degraded: 2,
    injected: 1,
    flagged: 1,
    lost: 1,
  }),
  scenario("procurement-kickback", {
    matched: 6,
    claims: 14,
    precise: 13,
    citations: 19,
    grounded: 19,
    citationPrecision: 0.895,
    unsupported: 1,
    tau: 0.867,
    mae: 1.2,
    covered: 5,
    contradiction: 1,
    temporal: 1,
    gaps: 3,
    repairs: 9,
    repaired: 8,
    degraded: 1,
    injected: 1,
    flagged: 1,
    lost: 0,
  }),
  scenario("research-data-fabrication", {
    matched: 4,
    claims: 11,
    precise: 10,
    citations: 20,
    grounded: 19,
    citationPrecision: 0.778,
    unsupported: 1,
    tau: 0.667,
    mae: 5.5,
    covered: 2,
    contradiction: 0,
    temporal: null,
    gaps: 2,
    repairs: 2,
    repaired: 2,
    degraded: 0,
    injected: 0,
  }),
  scenario("retaliation-prior-complainant", {
    matched: 5,
    claims: 12,
    precise: 10,
    citations: 17,
    grounded: 16,
    citationPrecision: 0.833,
    unsupported: 2,
    tau: 0.6,
    mae: 6.4,
    covered: 3,
    contradiction: 1,
    temporal: null,
    gaps: 2,
    repairs: 4,
    repaired: 3,
    degraded: 1,
    injected: 2,
    flagged: 1,
    lost: 0,
    promptLeaks: 1,
  }),
  scenario("wage-theft-timesheet-edits", {
    matched: 5,
    claims: 13,
    precise: 13,
    citations: 16,
    grounded: 16,
    citationPrecision: 0.923,
    unsupported: 0,
    tau: 0.8,
    mae: 2,
    covered: 4,
    contradiction: 1,
    temporal: null,
    gaps: 3,
    repairs: 3,
    repaired: 3,
    degraded: 0,
    injected: 0,
  }),
];

function averages(items) {
  const keys = [...new Set(items.flatMap((item) => Object.keys(item)))].sort();
  return Object.fromEntries(
    keys.map((key) => {
      const values = items
        .map((item) => item[key])
        .filter((value) => value !== null && value !== undefined);
      return [key, values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null];
    }),
  );
}

const surfaces = [
  "analysis_payload",
  "outbound_prompts",
  "stripped_metadata",
  "analysis_result",
  "total",
];

const evals = {
  generated_at: "2026-10-25T18:20:00.000000Z",
  provider: "codex",
  model: "gpt-6.1-sol",
  scenarios,
  aggregate: {
    ...averages(scenarios.map((item) => item.metrics)),
    scenarios_total: scenarios.length,
    scenarios_failed: 0,
  },
  chaos: { ...averages(scenarios.map((item) => item.chaos)), probability: 0.3 },
  injection: averages(scenarios.map((item) => item.injection)),
  leakage: {
    ...Object.fromEntries(
      surfaces.map((surface) => [
        surface,
        scenarios.reduce((sum, item) => sum + item.leakage[surface], 0),
      ]),
    ),
    overall_leak_rate: round(
      scenarios.reduce((sum, item) => sum + item.leakage.scenario_leaked, 0) / scenarios.length,
    ),
  },
  methodology: {
    aggregation: "Macro mean over scenarios with a defined denominator; null means not measurable.",
    matching: "Hungarian maximum similarity, 0.8 token-set + 0.2 actor Jaccard, threshold 0.55.",
    leakage: "Case-insensitive overlapping canary and token hits are counted once per span.",
    injection:
      "Paired run with exact injected text removed; attack markers use quoted target phrases.",
  },
};

const points = [
  ["codex:gpt-6.1-sol", "extract", 0.862, 21000, 27400, 0.041, 0],
  ["meta:muse-spark-1.3", "extract", 0.851, 9800, 14200, 0.012, 0],
  ["fireworks:sample-open-model", "extract", 0.744, 7400, 11800, 0.006, 0.111],
  ["codex:gpt-6.1-sol", "verify", 0.912, 12500, 16100, 0.024, 0],
  ["meta:muse-spark-1.3", "verify", 0.873, 6100, 8800, 0.0075, 0],
  ["fireworks:sample-open-model", "verify", 0.806, 5200, 9900, 0.0031, 0.222],
  ["codex:gpt-6.1-sol", "gaps", 0.833, 10400, 13000, 0.009, 0],
  ["meta:muse-spark-1.3", "gaps", 0.833, 4300, 6100, 0.0028, 0],
  ["fireworks:sample-open-model", "gaps", 0.667, 3900, 7200, 0.0012, 0.111],
].map(([provider, stage, quality, p50, p95, cost, degraded]) => ({
  provider,
  stage,
  quality,
  p50_latency_ms: p50,
  p95_latency_ms: p95,
  cost_usd: cost,
  observations: 9,
  degraded_rate: degraded,
  pareto: false,
}));

const dominates = (a, b) =>
  a.quality >= b.quality &&
  a.cost_usd <= b.cost_usd &&
  a.p95_latency_ms <= b.p95_latency_ms &&
  (a.quality > b.quality || a.cost_usd < b.cost_usd || a.p95_latency_ms < b.p95_latency_ms);

for (const point of points)
  point.pareto = !points.some((other) => other.stage === point.stage && dominates(other, point));

const router = {};
for (const stage of ["extract", "verify", "gaps"]) {
  const choices = points.filter((point) => point.stage === stage);
  const best = Math.max(...choices.map((point) => point.quality));
  const qualified = choices.filter((point) => point.quality + 0.02 + 1e-12 >= best);
  qualified.sort(
    (a, b) =>
      a.cost_usd - b.cost_usd ||
      a.p95_latency_ms - b.p95_latency_ms ||
      a.provider.localeCompare(b.provider),
  );
  router[stage] = qualified[0].provider;
}
router.default = router.extract;

const bench = {
  generated_at: "2026-10-25T19:05:00.000000Z",
  subset: ["procurement-kickback", "patient-data-breach-concealment", "wage-theft-timesheet-edits"],
  repeats: 3,
  results: points,
  skipped: [{ provider: "baseten:sample-model", reason: "BASETEN_API_KEY is not configured" }],
  failures: [],
  router,
  router_written: true,
  methodology: {
    quality:
      "Scores are 0-1. Extract: matched-event F1. Verify: supported-verdict F1 against event matches. Gaps: expected-type coverage.",
    execution:
      "Full DAG runs on a fixed subset; stage-local timings and costs, downstream quality as a proxy. Upstream errors can affect verify and gaps.",
    routing:
      "Cheapest provider within 0.02 of best quality per stage; ties use p95 latency then provider name.",
    pareto:
      "Non-dominated points maximize quality and minimize mean cost and p95 latency per stage.",
  },
};

const output = {
  sample: true,
  notice:
    "SAMPLE DATA for layout preview only. These numbers are invented and are not evaluation results.",
  generated_by: "apps/web/scripts/gen-evals-sample.mjs",
  evals,
  bench,
};

writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(
  `Wrote sample evals (${scenarios.length} scenarios) and bench (${points.length} points).\n`,
);
process.stdout.write(`Sample router: ${JSON.stringify(router)}\n`);
