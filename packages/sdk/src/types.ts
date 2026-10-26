import type { PseudonymEntry, ScrubResult, StrippedFile } from "@candor/privacy";

import type { components } from "./api.generated.js";

export type Schemas = components["schemas"];
export type Campaign = Schemas["CampaignDescriptor"];
export type Submission = Schemas["Submission"];
export type Submitted = Schemas["Submitted"];
export type ReportDetail = Schemas["ReportDetail"];
export type ReportStatus = Schemas["StatusChange"]["status"];
export type PaymentRequirements = Schemas["PaymentRequirements"];
export type SealStep = {
  id: "key" | "root" | "encrypt" | "split" | "analysis" | "inbox";
  data: Record<string, string | number>;
};
export type BuildSubmissionInput = {
  campaign: Campaign;
  token: Schemas["BlindToken"];
  files: StrippedFile[];
  variants: ("original" | "redacted")[];
  scrub: ScrubResult;
  statementKey: string;
  onStep?: (step: SealStep) => void;
};
export type BuiltSubmission = { body: Submission; codename: string };
export type ManifestFile = {
  index: number;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  variant: "original" | "redacted";
  metadata_removed: { field: string; preview: string }[];
};
export type Manifest = {
  v: 1;
  report_id: string;
  campaign_id: string;
  files: ManifestFile[];
  pseudonym_map: PseudonymEntry[];
  self_redaction_count: number;
};
export type SelfSession = {
  session_id: string;
  expires_at: string;
  self: {
    mode: "mock" | "staging" | "mainnet";
    scope: string;
    endpoint: string;
    app_name: string;
    user_id: string;
    user_id_type: "uuid";
    disclosures: { minimumAge: number; ofac: boolean };
  };
};
export type Verification = {
  status: "pending" | "verified" | "rejected" | "consumed";
  allowance: number;
  reason: string | null;
};
export type Issuance = { blind_signatures: string[]; key_id: string; epoch_ends_at: string };
export type DemoIdentity = {
  reviewer_id: string;
  display_name: string;
  role: "admin" | "reviewer" | "auditor";
  enc_pk: string;
  enc_sk: string;
  sig_pk: string;
  sig_sk: string;
};
export type Question = { question_id: string; text: string };
export type InboxQuestion = {
  kind: "question" | "message";
  body: string;
  questions: Question[];
  sent_at: string;
};
export type InboxReply = { kind: "reply"; body: string; answers: Question[]; sent_at: string };
export type InclusionProof = {
  index: number;
  tree_size: number;
  leaf_hash: string;
  audit_path: string[];
};
export type ConsistencyProof = { first: number; second: number; proof: string[] };
export type LogKey = { key_id: string; public_key: string };
