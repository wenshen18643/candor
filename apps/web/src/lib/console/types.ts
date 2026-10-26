import type { AnalysisResult, PseudonymEntry, StageEvent } from "@/lib/types";

export type ReviewerRole = "admin" | "reviewer" | "auditor";

export type ReviewerIdentity = {
  reviewerId: string;
  displayName: string;
  role: ReviewerRole;
  encPublicKey: string;
  encSecretKey: string;
  sigPublicKey: string;
  sigSecretKey: string;
};

export type ReportStatus = "received" | "triage" | "investigating" | "closed";

export type AnalysisState =
  | { status: "none" }
  | { status: "queued" | "running"; jobId: string; stage: string | null }
  | { status: "succeeded"; jobId: string; claims: number; updatedAt: string }
  | { status: "failed" | "dead"; jobId: string; error: string };

export type ReportSummary = {
  reportId: string;
  campaignId: string;
  campaignTitle: string;
  status: ReportStatus;
  receivedBucket: string;
  fileCount: number;
  sizeBucket: string;
  analysis: AnalysisState;
  unreadReplies: number;
  pendingAccess: number;
  headline: string | null;
};

export type ManifestFile = {
  index: number;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  variant: "original" | "redacted";
  metadataRemoved: { field: string; preview: string }[];
};

export type AccessApproval = {
  approverId: string;
  approverName: string;
  at: string;
};

export type AccessRequest = {
  requestId: string;
  reportId: string;
  requesterId: string;
  requesterName: string;
  reason: string;
  status: "pending" | "granted" | "denied" | "expired";
  approvals: AccessApproval[];
  threshold: number;
  createdAt: string;
};

export type ThreadMessage = {
  id: string;
  direction: "to_reporter" | "to_reviewers";
  author: string;
  body: string;
  questions: { questionId: string; text: string }[];
  sentAt: string;
};

export type ReportDetail = {
  summary: ReportSummary;
  evidenceRoot: string;
  logIndex: number;
  threshold: number;
  reviewers: { reviewerId: string; displayName: string; keyId: string }[];
  analysis: AnalysisResult | null;
  accessRequest: AccessRequest | null;
  messages: ThreadMessage[];
  priceUsd: number;
};

export type UnlockedEvidence = {
  files: ManifestFile[];
  pseudonymMap: PseudonymEntry[];
  selfRedactionCount: number;
};

export type PaymentRequirements = {
  scheme: string;
  network: string;
  asset: string;
  assetSymbol: string;
  maxAmountRequired: string;
  amountUsd: number;
  payTo: string;
  resource: string;
  description: string;
  maxTimeoutSeconds: number;
};

export type PaymentReceipt = {
  payer: string;
  txRef: string;
  network: string;
  amountUsd: number;
  mode: "mock" | "testnet";
};

export type StageEventHandler = (event: StageEvent) => void;

export interface ConsoleClient {
  mode: "showcase" | "live";
  listIdentities(): Promise<ReviewerIdentity[]>;
  signIn(identity: ReviewerIdentity): Promise<void>;
  listReports(): Promise<ReportSummary[]>;
  getReport(reportId: string): Promise<ReportDetail>;
  setStatus(reportId: string, status: ReportStatus): Promise<void>;
  quoteAnalysis(reportId: string): Promise<PaymentRequirements>;
  payAndRunAnalysis(
    reportId: string,
    requirements: PaymentRequirements,
    onEvent: StageEventHandler,
  ): Promise<{ receipt: PaymentReceipt; jobId: string; done: Promise<AnalysisResult> }>;
  watchAnalysis(
    reportId: string,
    jobId: string,
    onEvent: StageEventHandler,
  ): Promise<AnalysisResult>;
  requestAccess(reportId: string, reason: string): Promise<AccessRequest>;
  approveAccess(request: AccessRequest, approver: ReviewerIdentity): Promise<AccessRequest>;
  unlockEvidence(reportId: string, request: AccessRequest): Promise<UnlockedEvidence>;
  sendQuestions(
    reportId: string,
    body: string,
    questions: { questionId: string; text: string }[],
  ): Promise<ThreadMessage>;
}
