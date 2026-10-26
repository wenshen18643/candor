import type { KeyPair } from "@candor/crypto";
import { b64u, keyId, ready } from "@candor/crypto";
import type {
  Campaign,
  PaymentRequirements as WirePayment,
  ReportDetail as WireReport,
  Schemas,
  WalletSigner,
} from "@candor/sdk";
import {
  CandorClient,
  CandorError,
  combineReportShares,
  createApproval,
  createPayment,
  decryptFile,
  decryptManifest,
  openFindings,
  openMessage,
} from "@candor/sdk";

import { apiUrl, identityUrl } from "../config";
import type { AnalysisResult, StageEvent } from "../types";
import type {
  AccessRequest,
  AnalysisState,
  ConsoleClient,
  PaymentRequirements,
  ReportSummary,
  ReviewerIdentity,
  StageEventHandler,
  ThreadMessage,
} from "./types";

type Session = {
  sdk: CandorClient;
  identity: ReviewerIdentity;
  findings: Map<string, { jobId: string; result: AnalysisResult }>;
  sent: Map<string, ThreadMessage>;
  receipts: Map<string, Settlement>;
};

type Settlement = { payer: string; transaction: string; network: string };

type Quote = {
  wire: WirePayment;
  display: PaymentRequirements;
  mode: "mock" | "testnet";
  payment?: string;
  idempotencyKey: string;
};

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await globalThis.fetch(input, init);
  const unpaid = response.status === 402 && !new Headers(init?.headers).has("X-PAYMENT");
  if (!response.ok && !unpaid) {
    const value: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    const error = record(record(value).error);
    const failure = new CandorError(response.status, string(error.code, "http_error"));
    failure.message = string(error.message, `API request failed (${response.status})`);
    throw failure;
  }
  return response;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function createSdk(receipts?: Map<string, Settlement>): CandorClient {
  return new CandorClient({
    apiUrl,
    identityUrl: identityUrl || apiUrl,
    async fetch(input, init) {
      const response = await apiFetch(input, init);
      const header = response.headers.get("X-PAYMENT-RESPONSE");
      const idempotency = new Headers(init?.headers).get("Idempotency-Key");
      if (response.ok && header && idempotency && receipts) {
        let receipt: Record<string, unknown>;
        try { receipt = record(JSON.parse(atob(header))); }
        catch { throw new Error("Invalid payment settlement receipt"); }
        if (receipt.success !== true || !string(receipt.payer) || !string(receipt.transaction) || !string(receipt.network))
          throw new Error("Invalid payment settlement receipt");
        receipts.set(idempotency, { payer: string(receipt.payer), transaction: string(receipt.transaction), network: string(receipt.network) });
      }
      return response;
    },
  });
}

async function withBoxKeys<T>(
  identity: ReviewerIdentity,
  action: (keys: KeyPair) => Promise<T>,
): Promise<T> {
  await ready();
  const keys = {
    publicKey: b64u.decode(identity.encPublicKey),
    privateKey: b64u.decode(identity.encSecretKey),
  };
  try {
    return await action(keys);
  } finally {
    keys.privateKey.fill(0);
  }
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const divisor = bytes < 1048576 ? 1024 : 1048576;
  return `${Number((bytes / divisor).toFixed(2))} ${divisor === 1024 ? "KB" : "MB"}`;
}

function analysisState(
  snapshot: Schemas["JobSnapshot"] | null,
  result?: AnalysisResult,
): AnalysisState {
  if (!snapshot) return { status: "none" };
  const jobId = snapshot.job_id;
  switch (snapshot.status) {
    case "queued":
      return { status: "queued", jobId, stage: null };
    case "leased":
    case "running":
      return { status: "running", jobId, stage: null };
    case "succeeded":
      return {
        status: "succeeded",
        jobId,
        claims: result?.claims.length ?? 0,
        updatedAt: snapshot.updated_at,
      };
    case "failed":
    case "dead":
      return { status: snapshot.status, jobId, error: `Analysis ${snapshot.status}` };
    default:
      throw new Error("Unrecognized analysis status");
  }
}

const stages = new Set([
  "segment",
  "injection_scan",
  "extract",
  "consolidate",
  "ground",
  "verify",
  "temporal",
  "entities",
  "contradictions",
  "calibrate",
  "gaps",
  "brief",
]);
const statuses = new Set(["started", "progress", "succeeded", "degraded", "failed"]);

function stageEvent(event: StageEvent): StageEvent {
  if (!stages.has(event.stage) || !statuses.has(event.status))
    throw new Error("Invalid analysis stage event");
  return {
    job_id: event.job_id,
    stage: event.stage,
    status: event.status,
    at: event.at,
    detail: event.detail ?? "",
    progress: event.progress ?? null,
    provider: event.provider ?? null,
    model: event.model ?? null,
  };
}

async function browserWallet(): Promise<WalletSigner> {
  const provider = (
    globalThis as typeof globalThis & {
      ethereum?: { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
    }
  ).ethereum;
  if (!provider) throw new Error("Connect a browser wallet to pay on Base Sepolia");
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const address = Array.isArray(accounts) ? string(accounts[0]) : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("No wallet account available");
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: "0x14a34" }],
  });
  return {
    address,
    async signTypedData(data) {
      const types = {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        ...data.types,
      };
      const signature = await provider.request({
        method: "eth_signTypedData_v4",
        params: [address, JSON.stringify({ ...data, types })],
      });
      if (typeof signature !== "string") throw new Error("Wallet did not return a signature");
      return signature;
    },
  };
}

export function createLiveClient(): ConsoleClient {
  const identities = new Map<string, ReviewerIdentity>();
  const campaigns = new Map<string, Campaign>();
  const logIndices = new Map<string, number>();
  const quotes = new WeakMap<PaymentRequirements, Quote>();
  let session: Session | undefined;
  let signInVersion = 0;
  let demo: boolean | undefined;

  function current(): Session {
    if (!session) throw new Error("Sign in to the reviewer console first");
    return session;
  }

  async function campaign(sdk: CandorClient, id: string): Promise<Campaign> {
    const cached = campaigns.get(id);
    if (cached) return cached;
    const value = await sdk.loadCampaign(id);
    campaigns.set(id, value);
    return value;
  }

  async function listIdentities(): Promise<ReviewerIdentity[]> {
    const values = await createSdk().listIdentities();
    demo = true;
    return values.map((value) => {
      const identity: ReviewerIdentity = {
        reviewerId: value.reviewer_id,
        displayName: value.display_name,
        role: value.role,
        encPublicKey: value.enc_pk,
        encSecretKey: value.enc_sk,
        sigPublicKey: value.sig_pk,
        sigSecretKey: value.sig_sk,
      };
      identities.set(identity.reviewerId, identity);
      return { ...identity, encSecretKey: "", sigSecretKey: "" };
    });
  }

  async function authenticate(identity: ReviewerIdentity): Promise<Session> {
    if (!identity.sigSecretKey || !identity.encSecretKey) {
      if (!identities.has(identity.reviewerId)) await listIdentities();
      identity = identities.get(identity.reviewerId) ?? identity;
    }
    if (!identity.sigSecretKey || !identity.encSecretKey)
      throw new Error("Reviewer keys are unavailable");
    await ready();
    const receipts = new Map<string, Settlement>();
    const sdk = createSdk(receipts);
    const key = b64u.decode(identity.sigSecretKey);
    try {
      await sdk.signIn(identity.reviewerId, key);
    } finally {
      key.fill(0);
    }
    return { sdk, identity: { ...identity }, findings: new Map(), sent: new Map(), receipts };
  }

  async function mapSummary(
    active: Session,
    value: Schemas["ReportSummary"],
  ): Promise<ReportSummary> {
    const descriptor = await campaign(active.sdk, value.campaign_id);
    const opened = active.findings.get(value.report_id);
    return {
      reportId: value.report_id,
      campaignId: value.campaign_id,
      campaignTitle: descriptor.title,
      status: value.status,
      receivedBucket: value.received_bucket,
      fileCount: value.file_count,
      sizeBucket: sizeLabel(value.size_bucket),
      analysis: analysisState(
        value.analysis,
        opened?.jobId === value.analysis?.job_id ? opened?.result : undefined,
      ),
      unreadReplies: value.unread_replies,
      pendingAccess: value.pending_access,
      headline: opened?.result.summary.headline ?? null,
    };
  }

  async function openReport(
    active: Session,
    reportId: string,
    report: WireReport,
  ): Promise<AnalysisResult | null> {
    if (report.report.report_id !== reportId) throw new Error("Report identity mismatch");
    if (!report.findings) return null;
    const result = await withBoxKeys(active.identity, (keys) =>
      openFindings(reportId, report.findings!, keys),
    );
    active.findings.set(reportId, { jobId: report.findings.job_id, result });
    return result;
  }

  async function submissionIndex(sdk: CandorClient, reportId: string): Promise<number> {
    const cached = logIndices.get(reportId);
    if (cached !== undefined) return cached;
    const head = await sdk.getTreeHead();
    for (let start = 0; start < head.tree_size; start += 256) {
      const entries = await sdk.getLogEntries(start, Math.min(start + 256, head.tree_size));
      for (const entry of entries) {
        const id = string(record(entry.entry).report_id);
        if (entry.entry_type === "report.submitted" && id) logIndices.set(id, entry.index);
      }
      const index = logIndices.get(reportId);
      if (index !== undefined) return index;
    }
    throw new Error("Report submission is missing from the transparency log");
  }

  async function mapAccess(
    sdk: CandorClient,
    request: Schemas["AccessRequest-Output"],
    descriptor: Campaign,
  ): Promise<AccessRequest> {
    const listed = (await sdk.listAccessRequests(request.status)).find(
      (item) => item.id === request.id,
    );
    if (!listed && request.status === "pending") {
      const refreshed =
        (await sdk.listAccessRequests("granted")).find((item) => item.id === request.id) ??
        (await sdk.listAccessRequests("expired")).find((item) => item.id === request.id);
      if (refreshed) return mapAccess(sdk, refreshed, descriptor);
    }
    const name = (id: string): string =>
      descriptor.reviewers.find((reviewer) => reviewer.reviewer_id === id)?.display_name ??
      "Reviewer";
    return {
      requestId: request.id,
      reportId: request.report_id,
      requesterId: request.requester_id,
      requesterName: name(request.requester_id),
      reason: request.reason,
      status: listed?.status ?? request.status,
      approvals: (listed?.approvals ?? []).map((approval) => ({
        approverId: approval.approver_id,
        approverName: name(approval.approver_id),
        at: approval.created_at,
      })),
      threshold: descriptor.threshold,
      createdAt: request.created_at,
    };
  }

  async function messages(active: Session, report: WireReport): Promise<ThreadMessage[]> {
    const result: ThreadMessage[] = [];
    for (const value of report.messages) {
      const id = string(value.id);
      if (value.direction === "to_reporter") {
        const sent = active.sent.get(id);
        result.push(
          sent
            ? structuredClone(sent)
            : {
                id,
                direction: "to_reporter",
                author: "Reviewer",
                body: "",
                questions: [],
                sentAt: string(value.created_at),
              },
        );
        continue;
      }
      if (value.direction !== "to_reviewers" || !Array.isArray(value.boxes)) continue;
      const recipient = value.boxes
        .map(record)
        .find((box) => box.reviewer_id === active.identity.reviewerId);
      if (!recipient) continue;
      const opened = await withBoxKeys(active.identity, (keys) => openMessage(recipient.box, keys));
      if (opened.kind !== "reply") throw new Error("Invalid reporter reply");
      result.push({
        id,
        direction: "to_reviewers",
        author: "Reporter",
        body: opened.body,
        questions: opened.answers.map((answer) => ({
          questionId: answer.question_id,
          text: answer.text,
        })),
        sentAt: opened.sent_at,
      });
    }
    return result;
  }

  async function paymentMode(wire: WirePayment): Promise<"mock" | "testnet"> {
    const advertised = wire.extra?.mode ?? wire.extra?.x402_mode;
    if (advertised === "mock" || advertised === "testnet") return advertised;
    if (demo === undefined) {
      try {
        await listIdentities();
      } catch (error) {
        if (!(error instanceof CandorError) || error.status !== 404) throw error;
        demo = false;
      }
    }
    return demo ? "mock" : "testnet";
  }

  async function finishAnalysis(
    active: Session,
    reportId: string,
    jobId: string,
    onEvent: StageEventHandler,
  ): Promise<AnalysisResult> {
    for await (const event of active.sdk.streamJobEvents(jobId)) {
      if (event.event === "stage") {
        onEvent(stageEvent(event.data));
        continue;
      }
      if (event.data.status !== "succeeded") {
        const job = await active.sdk.getJob(jobId);
        throw new Error(job.last_error || `Analysis job ${event.data.status}`);
      }
      const report = await active.sdk.getReport(reportId);
      if (report.findings?.job_id !== jobId)
        throw new Error("Completed job findings are unavailable");
      const result = await openReport(active, reportId, report);
      if (!result) throw new Error("Completed job findings are unavailable");
      return result;
    }
    throw new Error("Analysis event stream ended before completion");
  }

  return {
    mode: "live",
    listIdentities,
    async signIn(identity) {
      const version = ++signInVersion;
      const authenticated = await authenticate(identity);
      if (version === signInVersion) session = authenticated;
    },
    async listReports() {
      const active = current();
      return Promise.all(
        (await active.sdk.listReports()).map((report) => mapSummary(active, report)),
      );
    },
    async getReport(reportId) {
      const active = current();
      const report = await active.sdk.getReport(reportId);
      const analysis = await openReport(active, reportId, report);
      const descriptor = await campaign(active.sdk, report.report.campaign_id);
      const requests = [...report.access_requests].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      );
      const request =
        requests.find(
          (item) =>
            item.requester_id === active.identity.reviewerId &&
            ["pending", "granted"].includes(item.status),
        ) ??
        requests.find((item) => item.status === "pending") ??
        requests[0];
      const [summary, logIndex, thread, accessRequest] = await Promise.all([
        mapSummary(active, report.report),
        submissionIndex(active.sdk, reportId),
        messages(active, report),
        request ? mapAccess(active.sdk, request, descriptor) : null,
      ]);
      await ready();
      return {
        summary,
        evidenceRoot: report.report.evidence_root,
        logIndex,
        threshold: descriptor.threshold,
        reviewers: descriptor.reviewers.map((reviewer) => ({
          reviewerId: reviewer.reviewer_id,
          displayName: reviewer.display_name,
          keyId: keyId(b64u.decode(reviewer.enc_pk)),
        })),
        analysis,
        accessRequest,
        messages: thread,
        priceUsd: Number(descriptor.analysis_price_usd),
      };
    },
    async setStatus(reportId, status) {
      await current().sdk.setStatus(reportId, status);
    },
    async quoteAnalysis(reportId) {
      const wire = await current().sdk.quoteAnalysis(reportId);
      const display: PaymentRequirements = {
        scheme: wire.scheme,
        network: wire.network,
        asset: wire.asset,
        assetSymbol: "USDC",
        maxAmountRequired: wire.maxAmountRequired,
        amountUsd: Number(wire.maxAmountRequired) / 1000000,
        payTo: wire.payTo,
        resource: wire.resource,
        description: wire.description,
        maxTimeoutSeconds: wire.maxTimeoutSeconds,
      };
      quotes.set(display, {
        wire,
        display: { ...display },
        mode: await paymentMode(wire),
        idempotencyKey: crypto.randomUUID(),
      });
      return display;
    },
    async payAndRunAnalysis(reportId, requirements, onEvent) {
      const active = current();
      const quote = quotes.get(requirements);
      if (
        !quote ||
        new URL(quote.wire.resource, apiUrl).pathname !==
          `/v1/reports/${encodeURIComponent(reportId)}/analysis` ||
        Object.keys(quote.display).some(
          (key) =>
            quote.display[key as keyof PaymentRequirements] !==
            requirements[key as keyof PaymentRequirements],
        )
      )
        throw new Error("Request a fresh analysis quote before paying");
      quote.payment ??= await createPayment(quote.wire, {
        mode: quote.mode,
        wallet: quote.mode === "testnet" ? await browserWallet() : undefined,
      });
      const job = await active.sdk.startAnalysis(reportId, quote.payment, quote.idempotencyKey);
      if (job.payment.status !== "settled") throw new Error("Analysis payment was not settled");
      const settlement = active.receipts.get(quote.idempotencyKey);
      if (!settlement) throw new Error("Payment settlement receipt is unavailable");
      const done = finishAnalysis(active, reportId, job.job_id, onEvent);
      void done.catch(() => undefined);
      return {
        receipt: {
          payer: settlement.payer,
          txRef: settlement.transaction,
          network: settlement.network,
          amountUsd: quote.display.amountUsd,
          mode: quote.mode,
        },
        jobId: job.job_id,
        done,
      };
    },
    async requestAccess(reportId, reason) {
      const active = current();
      const report = await active.sdk.getReport(reportId);
      const descriptor = await campaign(active.sdk, report.report.campaign_id);
      return mapAccess(active.sdk, await active.sdk.requestAccess(reportId, reason), descriptor);
    },
    async approveAccess(request, approver) {
      const active = await authenticate(approver);
      try {
        const pending = (await active.sdk.listAccessRequests()).find(
          (item) => item.id === request.requestId,
        );
        if (
          !pending ||
          pending.report_id !== request.reportId ||
          pending.requester_id !== request.requesterId
        )
          throw new Error("Access request is no longer pending");
        const report = await active.sdk.getReport(pending.report_id);
        const signKey = b64u.decode(active.identity.sigSecretKey);
        try {
          const approval = await withBoxKeys(active.identity, (boxKeys) =>
            createApproval({
              request: pending,
              sealedShare: report.my_sealed_share,
              boxKeys,
              signPrivateKey: signKey,
            }),
          );
          const updated = await active.sdk.approveAccess(pending.id, approval);
          return mapAccess(
            active.sdk,
            updated,
            await campaign(active.sdk, report.report.campaign_id),
          );
        } finally {
          signKey.fill(0);
        }
      } finally {
        active.sdk.signOut();
      }
    },
    async unlockEvidence(reportId, request) {
      const active = current();
      if (request.reportId !== reportId || request.requesterId !== active.identity.reviewerId)
        throw new Error("Access request does not belong to this reviewer and report");
      const access = await active.sdk.getAccessRequest(request.requestId);
      if (
        access.status !== "granted" ||
        access.report_id !== reportId ||
        access.requester_id !== active.identity.reviewerId
      )
        throw new Error("Evidence access has not been granted");
      const report = await active.sdk.getReport(reportId);
      const descriptor = await campaign(active.sdk, report.report.campaign_id);
      const shares = [
        access.sealed_share,
        ...access.resealed_shares.map((approval) => approval.resealed_share),
      ];
      const key = await withBoxKeys(active.identity, (keys) =>
        combineReportShares(shares, keys, descriptor.threshold),
      );
      try {
        const manifest = await decryptManifest(
          reportId,
          report.manifest_box,
          key,
          report.report.evidence_root,
        );
        for (const file of manifest.files) {
          const encrypted = await active.sdk.getFile(reportId, file.index);
          if (encrypted.index !== file.index) throw new Error("Evidence file index mismatch");
          const bytes = await decryptFile(reportId, file, encrypted.box, key);
          bytes.fill(0);
        }
        return {
          files: manifest.files.map(({ metadata_removed, ...file }) => ({
            ...file,
            metadataRemoved: metadata_removed,
          })),
          pseudonymMap: manifest.pseudonym_map,
          selfRedactionCount: manifest.self_redaction_count,
        };
      } finally {
        key.fill(0);
      }
    },
    async sendQuestions(reportId, body, questions) {
      const active = current();
      const report = await active.sdk.getReport(reportId);
      const sentAt = new Date().toISOString();
      const sent = await active.sdk.sendQuestions(reportId, report.report.inbox.enc_pk, {
        kind: questions.length ? "question" : "message",
        body,
        questions: questions.map((question) => ({
          question_id: question.questionId,
          text: question.text,
        })),
        sent_at: sentAt,
      });
      const message: ThreadMessage = {
        id: sent.id,
        direction: "to_reporter",
        author: active.identity.displayName,
        body,
        questions: structuredClone(questions),
        sentAt,
      };
      active.sent.set(sent.id, structuredClone(message));
      return message;
    },
  };
}

export const liveClient = createLiveClient();
