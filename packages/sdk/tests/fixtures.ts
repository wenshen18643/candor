import {
  b64u,
  generateBoxKeyPair,
  generateSignKeyPair,
  keyId,
  ready,
  sha256,
  toHex,
  utf8,
} from "@candor/crypto";
import type { ScrubResult, StrippedFile } from "@candor/privacy";

import type { AnalysisResult, BuildSubmissionInput, PaymentRequirements } from "../src/index.js";

export async function fixture(): Promise<{
  input: BuildSubmissionInput;
  reviewers: ReturnType<typeof generateBoxKeyPair>[];
  enclave: ReturnType<typeof generateBoxKeyPair>;
  signing: ReturnType<typeof generateSignKeyPair>[];
}> {
  await ready();
  const reviewers = Array.from({ length: 3 }, () => generateBoxKeyPair());
  const signing = reviewers.map(() => generateSignKeyPair());
  const enclave = generateBoxKeyPair();
  const bytes = utf8("Dana Whitfield changed 12 incidents to 2.");
  const files: StrippedFile[] = [
    {
      name: "memo.txt",
      mime: "text/plain",
      kind: "text",
      originalSize: bytes.length,
      bytes,
      sha256: toHex(sha256(bytes)),
      metadataRemoved: [{ field: "Author", value: "Synthetic Author", risk: "high" }],
      metadataRemaining: [],
      text: new TextDecoder().decode(bytes),
      anchorDate: null,
      title: "Private title",
    },
  ];
  const scrub: ScrubResult = {
    documents: [
      { docKey: "statement", text: "[REDACTED] witnessed the change." },
      { docKey: "D1", text: "PERSON_1 changed 12 incidents to 2." },
    ],
    pseudonymMap: [
      { placeholder: "PERSON_1", type: "person", value: "Dana Whitfield", variants: ["Dana"] },
    ],
    selfRedactionCount: 1,
    counts: { person: 1 },
    appliedDetections: 2,
  };
  return {
    reviewers,
    enclave,
    signing,
    input: {
      campaign: {
        campaign_id: "test",
        org: { slug: "test", name: "Test" },
        title: "Test",
        description: "Test",
        threshold: 2,
        analysis_price_usd: "0.50",
        identity_url: "https://identity.test",
        issuer: { key_id: "a".repeat(16), spki: "test" },
        enclave: { key_id: keyId(enclave.publicKey), enc_pk: b64u.encode(enclave.publicKey) },
        reviewers: reviewers.map((keys, index) => ({
          reviewer_id: `reviewer-${index}`,
          display_name: `Reviewer ${index}`,
          enc_pk: b64u.encode(keys.publicKey),
        })),
      },
      token: {
        key_id: "a".repeat(16),
        prepared: b64u.encode(new Uint8Array(64)),
        signature: b64u.encode(new Uint8Array(256)),
      },
      files,
      variants: ["original"],
      scrub,
      statementKey: "statement",
    },
  };
}

export const quote: PaymentRequirements = {
  scheme: "exact",
  network: "base-sepolia",
  asset: `0x${"a".repeat(40)}`,
  maxAmountRequired: "500000",
  payTo: `0x${"b".repeat(40)}`,
  resource: "https://api.test/v1/reports/r/analysis",
  description: "Analysis",
  mimeType: "application/json",
  maxTimeoutSeconds: 300,
  extra: { name: "USDC", version: "2" },
};

export function analysisResult(reportId: string): AnalysisResult {
  return {
    version: 1,
    report_id: reportId,
    generated_at: "2026-10-26T00:00:00Z",
    summary: {
      headline: "PERSON_1 and PERSON_10",
      overview: "PERSON_1",
      key_points: ["PERSON_1"],
      risk_notes: [],
      limitations: [],
    },
    documents: [],
    passages: [],
    claims: [],
    timeline: [],
    temporal_conflicts: [],
    entities: [
      {
        entity_id: "PERSON_1",
        placeholder: "PERSON_1",
        type: "person",
        aliases: ["PERSON_1"],
        roles: [],
        mention_count: 1,
      },
    ],
    relations: [],
    contradictions: [],
    follow_up_questions: [],
    injection_findings: [],
    stages: [],
    metrics: {
      claims_total: 0,
      claims_supported: 0,
      claims_unsupported: 0,
      citations_total: 0,
      citations_verified: 0,
      mean_confidence: 0,
      temporal_conflicts: 0,
      contradictions: 0,
      injection_passages: 0,
      total_cost_usd: 0,
      total_duration_ms: 0,
    },
    router: {},
  };
}
