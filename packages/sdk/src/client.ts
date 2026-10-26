import type { BlindToken, KeyPair, SignedTreeHead } from "@candor/crypto";
import {
  authMessage,
  b64u,
  deriveInboxKeys,
  inboxAuthMessage,
  prepareBlindTokens,
  ready,
  signDetached,
} from "@candor/crypto";

import type { PaymentOptions } from "./payments.js";
import { createPayment } from "./payments.js";
import { createApproval, openMessage, sealQuestion, sealReply } from "./reviewer.js";
import type { JobEvent, StreamOptions } from "./sse.js";
import { streamJobEvents } from "./sse.js";
import { verifyLogConsistency, verifySubmissionReceipt, verifyTreeHead } from "./transparency.js";
import type { Fetch, RequestOptions } from "./transport.js";
import { CandorError, delay, readJson, responseError, Transport } from "./transport.js";
import type {
  Campaign,
  ConsistencyProof,
  DemoIdentity,
  InboxQuestion,
  InboxReply,
  InclusionProof,
  Issuance,
  LogKey,
  PaymentRequirements,
  ReportDetail,
  ReportStatus,
  Schemas,
  SelfSession,
  Submission,
  Submitted,
  Verification,
} from "./types.js";

export type ClientOptions = {
  apiUrl: string;
  identityUrl: string;
  fetch?: Fetch;
  token?: string;
  inboxToken?: string;
};

export class CandorClient {
  private readonly api: Transport;
  private readonly identity: Transport;
  private token?: string;
  private inboxToken?: string;

  constructor(options: ClientOptions) {
    const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.api = new Transport(options.apiUrl, fetch);
    this.identity = new Transport(options.identityUrl, fetch);
    this.token = options.token;
    this.inboxToken = options.inboxToken;
  }

  setToken(token?: string): void {
    this.token = token;
  }
  setInboxToken(token?: string): void {
    this.inboxToken = token;
  }
  signOut(): void {
    this.token = undefined;
    this.inboxToken = undefined;
  }

  private async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    options?: RequestOptions,
    auth: "reviewer" | "inbox" | "public" = "reviewer",
  ): Promise<T> {
    const token = auth === "reviewer" ? this.token : auth === "inbox" ? this.inboxToken : undefined;
    return readJson<T>(await this.api.request(path, method, body, options, token));
  }

  private async identityRequest<T>(
    path: string,
    method = "GET",
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return readJson<T>(await this.identity.request(path, method, body, options));
  }

  loadCampaign(campaignId: string, options?: RequestOptions): Promise<Campaign> {
    return this.request(
      `/v1/campaigns/${encodeURIComponent(campaignId)}`,
      "GET",
      undefined,
      options,
      "public",
    );
  }

  startVerification(campaignId: string, options?: RequestOptions): Promise<SelfSession> {
    return this.identityRequest("/v1/sessions", "POST", { campaign_id: campaignId }, options);
  }

  mockVerify(sessionId: string, persona: string, options?: RequestOptions): Promise<Verification> {
    return this.identityRequest(
      `/v1/sessions/${encodeURIComponent(sessionId)}/mock-verify`,
      "POST",
      { persona },
      options,
    );
  }

  pollVerification(sessionId: string, options?: RequestOptions): Promise<Verification> {
    return this.identityRequest(
      `/v1/sessions/${encodeURIComponent(sessionId)}`,
      "GET",
      undefined,
      options,
    );
  }

  async waitForVerification(
    sessionId: string,
    options: { signal?: AbortSignal; intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<Verification> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 900000);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    while (true) {
      const result = await this.pollVerification(sessionId, { signal });
      if (result.status !== "pending") return result;
      await delay(options.intervalMs ?? 1000, signal);
    }
  }

  issueBlindTokens(
    sessionId: string,
    blindedMessages: string[],
    options?: RequestOptions,
  ): Promise<Issuance> {
    return this.identityRequest(
      `/v1/sessions/${encodeURIComponent(sessionId)}/issue`,
      "POST",
      { blinded_messages: blindedMessages },
      options,
    );
  }

  async mintTokens(
    campaign: Campaign,
    sessionId: string,
    count = 3,
    options?: RequestOptions,
  ): Promise<BlindToken[]> {
    const prepared = await prepareBlindTokens(campaign.issuer.spki, campaign.issuer.key_id, count);
    const issued = await this.issueBlindTokens(sessionId, prepared.blindedMessages, options);
    if (issued.key_id !== campaign.issuer.key_id) throw new CandorError(0, "issuer_key_mismatch");
    return prepared.finalize(issued.blind_signatures);
  }

  async submit(
    body: Submission,
    options: RequestOptions & { jitterMs?: number } = {},
  ): Promise<Submitted> {
    const random = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! / 4294967296;
    await delay(options.jitterMs ?? Math.floor(2000 + random * 18001), options.signal);
    return this.request("/v1/reports", "POST", body, options, "public");
  }

  sendChaff(body: unknown, options?: RequestOptions): Promise<void> {
    return this.request("/v1/chaff", "POST", body, options, "public");
  }

  async signIn(
    reviewerId: string,
    privateKey: Uint8Array,
    options?: RequestOptions,
  ): Promise<Schemas["ReviewerSession"]> {
    await ready();
    const { challenge } = await this.request<Schemas["Challenge"]>(
      "/v1/auth/challenge",
      "POST",
      { reviewer_id: reviewerId },
      options,
      "public",
    );
    const result = await this.request<Schemas["ReviewerSession"]>(
      "/v1/auth/token",
      "POST",
      {
        reviewer_id: reviewerId,
        challenge,
        signature: b64u.encode(signDetached(authMessage(reviewerId, challenge), privateKey)),
      },
      options,
      "public",
    );
    this.token = result.token;
    return result;
  }

  listIdentities(options?: RequestOptions): Promise<DemoIdentity[]> {
    return this.request("/v1/demo/identities", "GET", undefined, options, "public");
  }

  listReports(
    status?: ReportStatus,
    options?: RequestOptions,
  ): Promise<Schemas["ReportSummary"][]> {
    return this.request(
      `/v1/reports${status ? `?status=${encodeURIComponent(status)}` : ""}`,
      "GET",
      undefined,
      options,
    );
  }

  getReport(reportId: string, options?: RequestOptions): Promise<ReportDetail> {
    return this.request(`/v1/reports/${encodeURIComponent(reportId)}`, "GET", undefined, options);
  }

  getFile(
    reportId: string,
    index: number,
    options?: RequestOptions,
  ): Promise<Schemas["FileResponse"]> {
    return this.request(
      `/v1/reports/${encodeURIComponent(reportId)}/files/${index}`,
      "GET",
      undefined,
      options,
    );
  }

  setStatus(
    reportId: string,
    status: ReportStatus,
    options?: RequestOptions,
  ): Promise<{ report_id: string; status: ReportStatus }> {
    return this.request(
      `/v1/reports/${encodeURIComponent(reportId)}`,
      "PATCH",
      { status },
      options,
    );
  }

  async quoteAnalysis(reportId: string, options?: RequestOptions): Promise<PaymentRequirements> {
    const response = await this.api.request(
      `/v1/reports/${encodeURIComponent(reportId)}/analysis`,
      "POST",
      undefined,
      options,
      this.token,
    );
    if (response.status !== 402) {
      if (!response.ok) throw await responseError(response);
      throw new CandorError(response.status, "missing_payment_quote");
    }
    const body = (await response.json()) as Schemas["PaymentRequired"];
    if (body.x402Version !== 1 || !body.accepts?.length)
      throw new CandorError(402, "invalid_payment_quote");
    return body.accepts[0]!;
  }

  startAnalysis(
    reportId: string,
    payment: string,
    idempotencyKey: string,
    options: RequestOptions = {},
  ): Promise<Schemas["JobAccepted"]> {
    const headers = new Headers(options.headers);
    headers.set("X-PAYMENT", payment);
    headers.set("Idempotency-Key", idempotencyKey);
    return this.request(`/v1/reports/${encodeURIComponent(reportId)}/analysis`, "POST", undefined, {
      ...options,
      headers,
    });
  }

  async payAndRunAnalysis(
    reportId: string,
    requirements: PaymentRequirements,
    options: PaymentOptions & RequestOptions & { idempotencyKey?: string } = {},
  ): Promise<Schemas["JobAccepted"]> {
    const payment = await createPayment(requirements, options);
    return this.startAnalysis(
      reportId,
      payment,
      options.idempotencyKey ?? globalThis.crypto.randomUUID(),
      options,
    );
  }

  getJob(jobId: string, options?: RequestOptions): Promise<Schemas["JobDetail"]> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}`, "GET", undefined, options);
  }

  streamJobEvents(jobId: string, options?: StreamOptions): AsyncGenerator<JobEvent> {
    return streamJobEvents(
      (cursor, signal) => {
        const headers = new Headers({ Accept: "text/event-stream" });
        if (cursor) headers.set("Last-Event-ID", cursor);
        return this.api.request(
          `/v1/jobs/${encodeURIComponent(jobId)}/events`,
          "GET",
          undefined,
          { headers, signal },
          this.token,
        );
      },
      jobId,
      options,
    );
  }

  requestAccess(
    reportId: string,
    reason: string,
    options?: RequestOptions,
  ): Promise<Schemas["AccessRequest-Output"]> {
    return this.request(
      `/v1/reports/${encodeURIComponent(reportId)}/access-requests`,
      "POST",
      { reason },
      options,
    );
  }

  listAccessRequests(
    status: Schemas["ListedAccess"]["status"] = "pending",
    options?: RequestOptions,
  ): Promise<Schemas["ListedAccess"][]> {
    return this.request(
      `/v1/access-requests?status=${encodeURIComponent(status)}`,
      "GET",
      undefined,
      options,
    );
  }

  getAccessRequest(requestId: string, options?: RequestOptions): Promise<Schemas["AccessDetail"]> {
    return this.request(
      `/v1/access-requests/${encodeURIComponent(requestId)}`,
      "GET",
      undefined,
      options,
    );
  }

  approveAccess(
    requestId: string,
    approval: Schemas["Approval"],
    options?: RequestOptions,
  ): Promise<Schemas["AccessRequest-Output"]> {
    return this.request(
      `/v1/access-requests/${encodeURIComponent(requestId)}/approve`,
      "POST",
      approval,
      options,
    );
  }

  async signAndApproveAccess(
    args: Parameters<typeof createApproval>[0],
    options?: RequestOptions,
  ): Promise<Schemas["AccessRequest-Output"]> {
    return this.approveAccess(args.request.id, await createApproval(args), options);
  }

  async sendQuestions(
    reportId: string,
    inboxPublicKey: string,
    message: InboxQuestion,
    options?: RequestOptions,
  ): Promise<{ id: string }> {
    const box = await sealQuestion(message, inboxPublicKey);
    return this.request(
      `/v1/reports/${encodeURIComponent(reportId)}/messages`,
      "POST",
      { box, question_ids: message.questions.map((q) => q.question_id) },
      options,
    );
  }

  async signInInbox(
    codename: string,
    options?: RequestOptions,
  ): Promise<{ session: Schemas["InboxSession"]; keys: { sign: KeyPair; box: KeyPair } }> {
    const keys = await deriveInboxKeys(codename);
    try {
      const sig_pk = b64u.encode(keys.sign.publicKey);
      const { challenge } = await this.request<Schemas["Challenge"]>(
        "/v1/inbox/challenge",
        "POST",
        { sig_pk },
        options,
        "public",
      );
      const session = await this.request<Schemas["InboxSession"]>(
        "/v1/inbox/session",
        "POST",
        {
          sig_pk,
          challenge,
          signature: b64u.encode(
            signDetached(inboxAuthMessage(sig_pk, challenge), keys.sign.privateKey),
          ),
        },
        options,
        "public",
      );
      this.inboxToken = session.token;
      return { session, keys };
    } catch (error) {
      keys.sign.privateKey.fill(0);
      keys.box.privateKey.fill(0);
      throw error;
    }
  }

  getInboxMessages(options?: RequestOptions): Promise<Schemas["InboxMessages"]> {
    return this.request("/v1/inbox/messages", "GET", undefined, options, "inbox");
  }

  async readInbox(keys: KeyPair, options?: RequestOptions) {
    const inbox = await this.getInboxMessages(options);
    return Promise.all(
      inbox.reports.map(async (report) => ({
        ...report,
        messages: await Promise.all(
          report.messages.map(async (message) => ({
            ...message,
            plaintext:
              message.direction === "to_reporter" ? await openMessage(message.box, keys) : null,
          })),
        ),
      })),
    );
  }

  async reply(
    reportId: string,
    reviewers: Schemas["ReviewerPublic"][],
    message: InboxReply,
    options?: RequestOptions,
  ): Promise<{ id: string }> {
    const boxes = await sealReply(message, reviewers);
    return this.request(
      "/v1/inbox/messages",
      "POST",
      { report_id: reportId, boxes, answers_count: message.answers.length },
      options,
      "inbox",
    );
  }

  getLogKey(options?: RequestOptions): Promise<LogKey> {
    return this.request("/v1/log/key", "GET", undefined, options, "public");
  }
  getTreeHead(options?: RequestOptions): Promise<SignedTreeHead> {
    return this.request("/v1/log/sth", "GET", undefined, options, "public");
  }
  getLogEntries(
    start: number,
    end: number,
    options?: RequestOptions,
  ): Promise<Schemas["LogEntry"][]> {
    return this.request(
      `/v1/log/entries?start=${start}&end=${end}`,
      "GET",
      undefined,
      options,
      "public",
    );
  }
  getInclusionProof(
    index: number,
    treeSize: number,
    options?: RequestOptions,
  ): Promise<InclusionProof> {
    return this.request(
      `/v1/log/proofs/inclusion?index=${index}&tree_size=${treeSize}`,
      "GET",
      undefined,
      options,
      "public",
    );
  }
  getConsistencyProof(
    first: number,
    second: number,
    options?: RequestOptions,
  ): Promise<ConsistencyProof> {
    return this.request(
      `/v1/log/proofs/consistency?first=${first}&second=${second}`,
      "GET",
      undefined,
      options,
      "public",
    );
  }
  getAnchors(options?: RequestOptions): Promise<Schemas["Anchor"][]> {
    return this.request("/v1/log/anchors", "GET", undefined, options, "public");
  }

  async getVerifiedTreeHead(publicKey: string, options?: RequestOptions): Promise<SignedTreeHead> {
    const sth = await this.getTreeHead(options);
    if (!(await verifyTreeHead(sth, publicKey))) throw new CandorError(0, "invalid_tree_head");
    return sth;
  }

  async verifyConsistency(
    first: SignedTreeHead,
    second: SignedTreeHead,
    publicKey: string,
    options?: RequestOptions,
  ): Promise<boolean> {
    return verifyLogConsistency(
      first,
      second,
      await this.getConsistencyProof(first.tree_size, second.tree_size, options),
      publicKey,
    );
  }

  async verifyReceipt(
    submitted: Submitted,
    publicKey: string,
    options?: RequestOptions,
  ): Promise<boolean> {
    const { log_index, sth } = submitted.receipt;
    const [entries, proof] = await Promise.all([
      this.getLogEntries(log_index, log_index + 1, options),
      this.getInclusionProof(log_index, sth.tree_size, options),
    ]);
    const entry = entries[0];
    return entry !== undefined && verifySubmissionReceipt(submitted, entry, proof, publicKey);
  }
}
