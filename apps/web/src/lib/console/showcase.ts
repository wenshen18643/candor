import showcaseAnalysis from "@/data/showcase-analysis.json";
import { stageDependencies, stageOrder } from "@/lib/evidence";
import type { AnalysisResult, PseudonymEntry, StageEvent } from "@/lib/types";

import type {
  AccessRequest,
  ConsoleClient,
  ManifestFile,
  ReportDetail,
  ReportStatus,
  ReportSummary,
  ReviewerIdentity,
  ThreadMessage,
} from "./types";

const analysis = showcaseAnalysis as unknown as AnalysisResult;

const identities: ReviewerIdentity[] = [
  {
    reviewerId: "4c0e1f6a-2b7d-4e59-9a31-0d8f5b6c7e21",
    displayName: "Avery Chen",
    role: "admin",
    encPublicKey: "showcase",
    encSecretKey: "showcase",
    sigPublicKey: "showcase",
    sigSecretKey: "showcase",
  },
  {
    reviewerId: "9d2b7a14-6e3c-4f80-b1a5-3c7e9f0a2d68",
    displayName: "Morgan Ellis",
    role: "reviewer",
    encPublicKey: "showcase",
    encSecretKey: "showcase",
    sigPublicKey: "showcase",
    sigSecretKey: "showcase",
  },
  {
    reviewerId: "e7a3c58b-1f94-4d2e-8b06-5a4d1c9e3f70",
    displayName: "Riley Park",
    role: "auditor",
    encPublicKey: "showcase",
    encSecretKey: "showcase",
    sigPublicKey: "showcase",
    sigSecretKey: "showcase",
  },
];

const keyIds = ["3f9a1c7e5b2d8046", "a71e0c94d3b6f528", "c5d802ef7b19a364"];

export const showcasePseudonyms: PseudonymEntry[] = [
  {
    placeholder: "PERSON_1",
    type: "person",
    value: "Dana Whitfield",
    variants: ["Dana", "D. Whitfield"],
  },
  { placeholder: "PERSON_2", type: "person", value: "Marcus Hale", variants: ["Marcus"] },
  { placeholder: "PERSON_3", type: "person", value: "Graham Whitfield", variants: ["Graham"] },
  {
    placeholder: "PERSON_4",
    type: "person",
    value: "Elena Sorensen",
    variants: ["Elena", "E. Sorensen"],
  },
  { placeholder: "PERSON_5", type: "person", value: "Priya Raman", variants: ["Priya"] },
  { placeholder: "PERSON_6", type: "person", value: "Tomás Reyes", variants: ["Tomás", "Tomas"] },
  { placeholder: "ORG_1", type: "org", value: "Northwind Health", variants: ["Northwind"] },
  { placeholder: "ORG_2", type: "org", value: "MedAxis Supply", variants: ["MedAxis", "medaxis"] },
  { placeholder: "ORG_3", type: "org", value: "Harborline Advisory LLC", variants: ["Harborline"] },
  { placeholder: "ORG_4", type: "org", value: "Corvane Medical", variants: ["Corvane"] },
  { placeholder: "EMAIL_1", type: "email", value: "d.whitfield@northwind.example", variants: [] },
  { placeholder: "EMAIL_2", type: "email", value: "procurement@northwind.example", variants: [] },
];

const manifestFiles: ManifestFile[] = [
  {
    index: 0,
    name: "Infusion pump RFP - evaluation timeline.eml",
    mime: "message/rfc822",
    size: 4182,
    sha256: "9b2f6c1e0a7d4f3b8e5c2a9d1f0e7b6c4a3d2e1f0b9c8a7d6e5f4a3b2c1d0e9f",
    variant: "redacted",
    metadataRemoved: [
      { field: "Received", preview: "3 relay hops" },
      { field: "X-Originating-IP", preview: "10.4.***.***" },
      { field: "Message-ID", preview: "<CA+***@mail.northwind.example>" },
      { field: "X-Mailer", preview: "Microsoft Outlook 16.0" },
    ],
  },
  {
    index: 1,
    name: "RE MedAxis technical score.eml",
    mime: "message/rfc822",
    size: 3307,
    sha256: "1c8e4a7f2b9d0e6c3a5f8b1d4e7a0c9f2e5b8d1a4c7f0e3b6d9a2c5f8e1b4d7a",
    variant: "redacted",
    metadataRemoved: [
      { field: "Received", preview: "2 relay hops" },
      { field: "X-Originating-IP", preview: "10.4.***.***" },
      { field: "DKIM-Signature", preview: "d=northwind.example" },
    ],
  },
  {
    index: 2,
    name: "dm-export-2026-03-06.txt",
    mime: "text/plain",
    size: 612,
    sha256: "7e1a4d8b2f5c9e0a3d6b1f4c7a0e3d9b2c5f8a1e4d7b0c3f6a9e2d5b8c1f4a7e",
    variant: "redacted",
    metadataRemoved: [{ field: "Zero-width characters", preview: "14 removed" }],
  },
  {
    index: 3,
    name: "Committee minutes - infusion pumps.docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 18944,
    sha256: "3a6d9c2f5e8b1a4d7c0f3e6b9d2a5c8f1e4b7a0d3c6f9e2b5a8d1c4f7e0b3a6d",
    variant: "original",
    metadataRemoved: [
      { field: "Creator", preview: "D*** W***" },
      { field: "LastModifiedBy", preview: "J*** O***" },
      { field: "Company", preview: "Northwind Health" },
      { field: "Revision", preview: "7" },
      { field: "Tracked-change author", preview: "J*** O***" },
    ],
  },
  {
    index: 4,
    name: "ap-extract-2026-04.csv",
    mime: "text/csv",
    size: 1290,
    sha256: "5c8f1b4e7a0d3c6f9b2e5a8d1c4f7b0e3a6d9c2f5b8e1a4d7c0f3b6e9a2d5c8f",
    variant: "redacted",
    metadataRemoved: [{ field: "Byte-order mark", preview: "UTF-8 BOM" }],
  },
  {
    index: 5,
    name: "MedAxis cover letter.pdf",
    mime: "application/pdf",
    size: 88213,
    sha256: "8d1e4a7c0f3b6d9e2a5c8f1b4e7d0a3c6f9b2e5d8a1c4f7e0b3d6a9c2f5e8b1d",
    variant: "original",
    metadataRemoved: [
      { field: "Author", preview: "M*** H***" },
      { field: "Producer", preview: "Adobe PDF Library 24.1" },
      { field: "CreationDate", preview: "2026-02-16" },
      { field: "XMP metadata", preview: "2.1 KB packet" },
    ],
  },
];

const reportDefaults = [
  {
    reportId: analysis.report_id,
    campaignId: "northwind-ethics",
    campaignTitle: "Ethics & compliance",
    status: "triage" as ReportStatus,
    receivedBucket: "2026-10-26T09:00:00Z",
    fileCount: 6,
    sizeBucket: "128 KB",
    unreadReplies: 1,
    pendingAccess: 0,
    analysed: true,
  },
  {
    reportId: "3b9e0d71-c4a2-4f6e-8d15-7a2c9e4b1f03",
    campaignId: "northwind-safety",
    campaignTitle: "Patient safety",
    status: "received" as ReportStatus,
    receivedBucket: "2026-10-26T11:00:00Z",
    fileCount: 4,
    sizeBucket: "64 KB",
    unreadReplies: 0,
    pendingAccess: 0,
    analysed: false,
  },
  {
    reportId: "c81f5a3e-0d7b-4b92-a6e4-2f9d1c8b7a50",
    campaignId: "northwind-ethics",
    campaignTitle: "Ethics & compliance",
    status: "received" as ReportStatus,
    receivedBucket: "2026-10-26T12:00:00Z",
    fileCount: 2,
    sizeBucket: "16 KB",
    unreadReplies: 0,
    pendingAccess: 0,
    analysed: false,
  },
];

type ShowcaseState = {
  statuses: Record<string, ReportStatus>;
  analyses: Record<string, AnalysisResult | null>;
  access: Record<string, AccessRequest | null>;
  messages: Record<string, ThreadMessage[]>;
};

const state: ShowcaseState = {
  statuses: Object.fromEntries(reportDefaults.map((report) => [report.reportId, report.status])),
  analyses: Object.fromEntries(
    reportDefaults.map((report) => [report.reportId, report.analysed ? analysis : null]),
  ),
  access: {},
  messages: {
    [analysis.report_id]: [
      {
        id: "m1",
        direction: "to_reporter",
        author: "Avery Chen",
        body: "Thank you for your report. We have a few questions that would help us understand the timeline.",
        questions: analysis.follow_up_questions.slice(0, 2).map((question) => ({
          questionId: question.question_id,
          text: question.question,
        })),
        sentAt: "2026-10-26T10:00:00Z",
      },
      {
        id: "m2",
        direction: "to_reviewers",
        author: "Reporter",
        body: "The meeting was not moved as far as I know. Nobody on the team got a new invite for the 10th. I don't have the company registration for ORG_3 but I can try to find it.",
        questions: [],
        sentAt: "2026-10-26T13:00:00Z",
      },
    ],
  },
};

let signedIn: ReviewerIdentity | null = null;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summaryFor(reportId: string): ReportSummary {
  const base = reportDefaults.find((report) => report.reportId === reportId);
  if (!base) throw new Error("Report not found");
  const result = state.analyses[reportId];
  const access = state.access[reportId];
  return {
    reportId,
    campaignId: base.campaignId,
    campaignTitle: base.campaignTitle,
    status: state.statuses[reportId] ?? base.status,
    receivedBucket: base.receivedBucket,
    fileCount: base.fileCount,
    sizeBucket: base.sizeBucket,
    analysis: result
      ? {
          status: "succeeded",
          jobId: `job-${reportId.slice(0, 8)}`,
          claims: result.claims.length,
          updatedAt: result.generated_at,
        }
      : { status: "none" },
    unreadReplies: (state.messages[reportId] ?? []).filter(
      (message) => message.direction === "to_reviewers",
    ).length,
    pendingAccess: access && access.status === "pending" ? 1 : 0,
    headline: result?.summary.headline ?? null,
  };
}

function scheduleStages(totalMs: number) {
  const durations = Object.fromEntries(
    analysis.stages.map((stage) => [stage.stage, Math.max(stage.duration_ms, 400)]),
  );
  const total = analysis.stages.reduce((sum, stage) => sum + Math.max(stage.duration_ms, 400), 0);
  const scale = totalMs / total;
  const finish: Record<string, number> = {};
  const start: Record<string, number> = {};
  for (const stage of stageOrder) {
    const deps = stageDependencies[stage] ?? [];
    start[stage] = Math.max(0, ...deps.map((dep) => finish[dep] ?? 0));
    finish[stage] = (start[stage] ?? 0) + (durations[stage] ?? 400) * scale;
  }
  return { start, finish };
}

export const showcaseClient: ConsoleClient = {
  mode: "showcase",
  async listIdentities() {
    return identities;
  },
  async signIn(identity) {
    signedIn = identity;
    await wait(250);
  },
  async listReports() {
    await wait(120);
    return reportDefaults.map((report) => summaryFor(report.reportId));
  },
  async getReport(reportId) {
    await wait(150);
    const detail: ReportDetail = {
      summary: summaryFor(reportId),
      evidenceRoot: "e3b8c4f1a90d27b65c1e8f3a4d7b2c9e0f6a5d1b8c3e7f2a4d9b6c1e5f8a3d70",
      logIndex: 17,
      threshold: 2,
      reviewers: identities.map((identity, index) => ({
        reviewerId: identity.reviewerId,
        displayName: identity.displayName,
        keyId: keyIds[index] ?? "",
      })),
      analysis: state.analyses[reportId] ?? null,
      accessRequest: state.access[reportId] ?? null,
      messages: state.messages[reportId] ?? [],
      priceUsd: 0.5,
    };
    return detail;
  },
  async setStatus(reportId, status) {
    state.statuses[reportId] = status;
    await wait(100);
  },
  async quoteAnalysis(reportId) {
    await wait(200);
    return {
      scheme: "exact",
      network: "base-sepolia",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      assetSymbol: "USDC",
      maxAmountRequired: "500000",
      amountUsd: 0.5,
      payTo: "0x0000000000000000000000000000000000000402",
      resource: `/v1/reports/${reportId}/analysis`,
      description: "Candor evidence analysis, one run",
      maxTimeoutSeconds: 120,
    };
  },
  async payAndRunAnalysis(reportId, requirements, onEvent) {
    await wait(900);
    const jobId = `job-${crypto.randomUUID().slice(0, 8)}`;
    const receipt = {
      payer: "0x7a3F…c91E",
      txRef: `mock-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
      network: requirements.network,
      amountUsd: requirements.amountUsd,
      mode: "mock" as const,
    };
    const { start, finish } = scheduleStages(14000);
    const emit = (stage: string, status: StageEvent["status"], detail = "") => {
      const run = analysis.stages.find((item) => item.stage === stage);
      onEvent({
        job_id: jobId,
        stage: stage as StageEvent["stage"],
        status,
        at: new Date().toISOString(),
        detail,
        progress: null,
        provider: run?.provider ?? null,
        model: run?.model ?? null,
      });
    };
    const done = new Promise<AnalysisResult>((resolve) => {
      for (const stage of stageOrder) {
        const run = analysis.stages.find((item) => item.stage === stage);
        setTimeout(() => emit(stage, "started"), start[stage]);
        setTimeout(() => emit(stage, "succeeded", run?.notes.join("; ") ?? ""), finish[stage]);
      }
      const end = Math.max(...Object.values(finish));
      setTimeout(() => {
        state.analyses[reportId] = { ...analysis, report_id: reportId };
        resolve(state.analyses[reportId] as AnalysisResult);
      }, end + 150);
    });
    return { receipt, jobId, done };
  },
  async watchAnalysis(reportId) {
    const finished = state.analyses[reportId];
    if (!finished) throw new Error("No analysis is running for this report");
    return finished;
  },
  async requestAccess(reportId, reason) {
    await wait(300);
    const requester = signedIn ?? identities[0];
    const request: AccessRequest = {
      requestId: crypto.randomUUID(),
      reportId,
      requesterId: requester?.reviewerId ?? "",
      requesterName: requester?.displayName ?? "",
      reason,
      status: "pending",
      approvals: [],
      threshold: 2,
      createdAt: new Date().toISOString(),
    };
    state.access[reportId] = request;
    return request;
  },
  async approveAccess(request, approver) {
    await wait(700);
    const updated: AccessRequest = {
      ...request,
      approvals: [
        ...request.approvals,
        {
          approverId: approver.reviewerId,
          approverName: approver.displayName,
          at: new Date().toISOString(),
        },
      ],
    };
    if (updated.approvals.length >= updated.threshold - 1) updated.status = "granted";
    state.access[request.reportId] = updated;
    return updated;
  },
  async unlockEvidence() {
    await wait(900);
    return { files: manifestFiles, pseudonymMap: showcasePseudonyms, selfRedactionCount: 7 };
  },
  async sendQuestions(reportId, body, questions) {
    await wait(500);
    const message: ThreadMessage = {
      id: crypto.randomUUID(),
      direction: "to_reporter",
      author: signedIn?.displayName ?? "Reviewer",
      body,
      questions,
      sentAt: new Date().toISOString(),
    };
    state.messages[reportId] = [...(state.messages[reportId] ?? []), message];
    return message;
  },
};
