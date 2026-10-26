import {
  approvalMessage,
  authMessage,
  b64u,
  context,
  encryptBox,
  encryptJson,
  generateBoxKeyPair,
  generateSignKeyPair,
  merkleRoot,
  openSealedKey,
  ready,
  sealJson,
  sealKey,
  sha256,
  splitKey,
  toHex,
  utf8,
  verifyDetached,
} from "@candor/crypto";
import type { AnalysisResult, Campaign, Manifest, Schemas } from "@candor/sdk";
import { buildSubmission, CandorClient, openMessage } from "@candor/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import recordedAnalysis from "../../data/showcase-analysis.json";
import { apiUrl, identityUrl } from "../config";
import type { StageEvent } from "../types";
import { createLiveClient } from "./live";

vi.mock("../config", () => ({
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "https://api.test",
  identityUrl: process.env.NEXT_PUBLIC_IDENTITY_URL ?? "https://identity.test",
}));

const reportId = "10000000-0000-4000-8000-000000000001";
const jobId = "20000000-0000-4000-8000-000000000002";
const at = "2026-10-26T10:00:00Z";

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function failure(message: string, status = 403): Response {
  return json({ error: { code: "denied", message } }, status);
}

async function fixture() {
  await ready();
  const boxes = [generateBoxKeyPair(), generateBoxKeyPair(), generateBoxKeyPair()];
  const signs = boxes.map(() => generateSignKeyPair());
  const identities = boxes.map((box, index) => ({
    reviewer_id: `reviewer-${index}`,
    display_name: `Reviewer ${index}`,
    role: "reviewer" as const,
    enc_pk: b64u.encode(box.publicKey),
    enc_sk: b64u.encode(box.privateKey),
    sig_pk: b64u.encode(signs[index]!.publicKey),
    sig_sk: b64u.encode(signs[index]!.privateKey),
  }));
  const inbox = generateBoxKeyPair();
  const key = new Uint8Array(32).fill(17);
  const shares = await splitKey(key, 3, 2);
  const bytes = utf8("Synthetic evidence for the reviewer client test.");
  const file = {
    index: 0,
    name: "synthetic.txt",
    mime: "text/plain",
    size: bytes.length,
    sha256: toHex(sha256(bytes)),
    variant: "original" as const,
    metadata_removed: [{ field: "Author", preview: "***" }],
  };
  const manifest: Manifest = {
    v: 1,
    report_id: reportId,
    campaign_id: "test",
    files: [file],
    pseudonym_map: [
      { placeholder: "PERSON_1", type: "person", value: "Synthetic Person", variants: [] },
    ],
    self_redaction_count: 2,
  };
  const result = { ...recordedAnalysis, report_id: reportId } as unknown as AnalysisResult;
  const findingsBytes = utf8(JSON.stringify(result));
  const findings = {
    job_id: jobId,
    box: encryptBox(key, findingsBytes, context("findings", reportId)),
    sealed_key: sealKey(key, boxes[0]!.publicKey),
    findings_sha256: toHex(sha256(findingsBytes)),
  };
  const campaign: Campaign = {
    campaign_id: "test",
    title: "Test campaign",
    description: "Synthetic",
    org: { slug: "test", name: "Test" },
    threshold: 2,
    analysis_price_usd: "0.50",
    identity_url: identityUrl,
    issuer: { key_id: "issuer", spki: "unused" },
    enclave: { key_id: "enclave", enc_pk: identities[0]!.enc_pk },
    reviewers: identities.map((identity) => ({
      reviewer_id: identity.reviewer_id,
      display_name: identity.display_name,
      enc_pk: identity.enc_pk,
    })),
  };
  const summary: Schemas["ReportSummary"] = {
    report_id: reportId,
    campaign_id: "test",
    status: "triage",
    received_bucket: at,
    file_count: 1,
    size_bucket: 131072,
    analysis: { status: "succeeded", job_id: jobId, updated_at: at },
    unread_replies: 2,
    pending_access: 1,
  };
  const request: Schemas["ListedAccess"] = {
    id: "request-1",
    report_id: reportId,
    requester_id: identities[0]!.reviewer_id,
    requester_enc_pk: identities[0]!.enc_pk,
    reason: "Synthetic review",
    status: "pending",
    created_at: at,
    expires_at: "2099-01-01T00:00:00Z",
    approvals: [],
  };
  const reply = {
    kind: "reply",
    body: "Synthetic reply",
    answers: [{ question_id: "Q1", text: "Confirmed" }],
    sent_at: at,
  };
  const report: Schemas["ReportDetail"] = {
    report: {
      ...summary,
      evidence_root: toHex(merkleRoot([sha256(bytes)])),
      inbox: { enc_pk: b64u.encode(inbox.publicKey), sig_pk: identities[0]!.sig_pk },
    },
    manifest_box: encryptJson(key, manifest, context("manifest", reportId)),
    files: [{ index: 0, size: 128 }],
    my_sealed_share: sealKey(shares[0]!, boxes[0]!.publicKey),
    findings,
    access_requests: [],
    messages: [
      { id: "old-question", direction: "to_reporter", created_at: at },
      {
        id: "reply-1",
        direction: "to_reviewers",
        created_at: at,
        boxes: [
          { reviewer_id: identities[0]!.reviewer_id, box: sealJson(reply, boxes[0]!.publicKey) },
        ],
      },
      {
        id: "other-reply",
        direction: "to_reviewers",
        created_at: at,
        boxes: [
          { reviewer_id: identities[1]!.reviewer_id, box: sealJson(reply, boxes[1]!.publicKey) },
        ],
      },
    ],
  };
  return {
    boxes,
    signs,
    identities,
    inbox,
    key,
    shares,
    bytes,
    manifest,
    result,
    campaign,
    summary,
    request,
    report,
    fileBox: encryptBox(key, bytes, context("file/0", reportId)),
    requirements: {
      scheme: "exact",
      network: "base-sepolia",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      maxAmountRequired: "500000",
      payTo: "0x0000000000000000000000000000000000000402",
      resource: `${apiUrl}/v1/reports/${reportId}/analysis`,
      description: "Analysis",
      mimeType: "application/json",
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" } as Record<string, string>,
    },
  };
}

describe("live reviewer client", () => {
  let data: Awaited<ReturnType<typeof fixture>>;
  let client: ReturnType<typeof createLiveClient>;
  let handler: ReturnType<typeof vi.fn<typeof fetch>>;
  let stageStatus: string;
  let approvals: Schemas["AccessApproval"][];
  let sentBox: unknown;

  beforeEach(async () => {
    data = await fixture();
    client = createLiveClient();
    stageStatus = "succeeded";
    approvals = [];
    sentBox = undefined;
    handler = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input));
      const path = url.pathname;
      const headers = new Headers(init?.headers);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (path === "/v1/demo/identities") return json(data.identities);
      if (path === "/v1/auth/challenge")
        return json({ challenge: "test-challenge", expires_at: at });
      if (path === "/v1/auth/token") {
        const index = data.identities.findIndex(
          (identity) => identity.reviewer_id === body.reviewer_id,
        );
        const valid =
          index >= 0 &&
          verifyDetached(
            b64u.decode(String(body.signature)),
            authMessage(String(body.reviewer_id), String(body.challenge)),
            data.signs[index]!.publicKey,
          );
        if (!valid) return failure("Reviewer signature is invalid");
        return json({ token: `session-${index}`, expires_at: at });
      }
      if (path === "/v1/campaigns/test") return json(data.campaign);
      if (path === "/v1/log/sth") return json({ tree_size: 1 });
      if (path === "/v1/log/entries")
        return json([{ index: 0, entry_type: "report.submitted", entry: { report_id: reportId } }]);
      if (!headers.get("Authorization")?.startsWith("Bearer session-"))
        return failure("Sign-in required", 401);
      const reviewerIndex = Number(headers.get("Authorization")!.slice(-1));
      if (path === "/v1/reports") return json([data.summary]);
      if (path === `/v1/reports/${reportId}` && init?.method === "PATCH") {
        data.summary.status = body.status as Schemas["ReportSummary"]["status"];
        return json({ report_id: reportId, status: body.status });
      }
      if (path === `/v1/reports/${reportId}`)
        return json({
          ...data.report,
          my_sealed_share: sealKey(
            data.shares[reviewerIndex]!,
            data.boxes[reviewerIndex]!.publicKey,
          ),
          findings: data.report.findings
            ? {
                ...data.report.findings,
                sealed_key: sealKey(data.key, data.boxes[reviewerIndex]!.publicKey),
              }
            : null,
        });
      if (path === `/v1/reports/${reportId}/files/0`) return json({ index: 0, box: data.fileBox });
      if (path === `/v1/reports/${reportId}/analysis`) {
        if (!headers.has("X-PAYMENT"))
          return json({ x402Version: 1, accepts: [data.requirements] }, 402);
        return json(
          {
            job_id: jobId,
            status: "queued",
            payment: {
              scheme: "exact",
              network: "base-sepolia",
              amount_atomic: "500000",
              status: "settled",
            },
          },
          202,
          {
            "X-PAYMENT-RESPONSE": btoa(
              JSON.stringify({
                success: true,
                payer: "0x0000000000000000000000000000000000000001",
                transaction: "mock-settlement",
                network: "base-sepolia",
              }),
            ),
          },
        );
      }
      if (path === `/v1/jobs/${jobId}/events`) {
        const event = { job_id: jobId, stage: "segment", status: "started", at };
        const stream = `id: 1\nevent: stage\ndata: ${JSON.stringify(event)}\n\nevent: done\ndata: ${JSON.stringify({ job_id: jobId, status: stageStatus })}\n\n`;
        const bytes = utf8(stream);
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes.slice(0, 39));
              controller.enqueue(bytes.slice(39));
              controller.close();
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      if (path === `/v1/jobs/${jobId}`)
        return json({ job_id: jobId, status: stageStatus, last_error: "worker_exhausted" });
      if (path === `/v1/reports/${reportId}/access-requests`) {
        data.request.reason = String(body.reason);
        return json(data.request, 201);
      }
      if (path === "/v1/access-requests")
        return json(url.searchParams.get("status") === data.request.status ? [data.request] : []);
      if (path === "/v1/access-requests/request-1")
        return json({
          ...data.request,
          sealed_share: data.report.my_sealed_share,
          resealed_shares: approvals,
        });
      if (path === "/v1/access-requests/request-1/approve") {
        const valid = verifyDetached(
          b64u.decode(String(body.signature)),
          approvalMessage("request-1", reportId, data.identities[0]!.reviewer_id),
          data.signs[reviewerIndex]!.publicKey,
        );
        if (!valid) return failure("Approval signature is invalid");
        const share = openSealedKey(
          String(body.resealed_share),
          data.boxes[0]!.publicKey,
          data.boxes[0]!.privateKey,
        );
        if (toHex(share) !== toHex(data.shares[reviewerIndex]!))
          return failure("Approval share mismatch");
        approvals.push({
          request_id: "request-1",
          approver_id: data.identities[reviewerIndex]!.reviewer_id,
          resealed_share: String(body.resealed_share),
          signature: String(body.signature),
          created_at: at,
        });
        data.request.status = "granted";
        data.request.approvals.push({
          approver_id: data.identities[reviewerIndex]!.reviewer_id,
          created_at: at,
        });
        return json(data.request);
      }
      if (path === `/v1/reports/${reportId}/messages`) {
        sentBox = body.box;
        data.report.messages.push({ id: "sent-1", direction: "to_reporter", created_at: at });
        return json({ id: "sent-1" }, 201);
      }
      return failure("Not found", 404);
    });
    vi.stubGlobal("fetch", handler);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function signIn() {
    const identities = await client.listIdentities();
    await client.signIn(identities[0]!);
    return identities;
  }

  it("signs the Ed25519 challenge and keeps credentials out of returned identities and public requests", async () => {
    const identities = await signIn();
    expect(identities[0]).toMatchObject({
      reviewerId: "reviewer-0",
      encSecretKey: "",
      sigSecretKey: "",
    });
    await client.listReports();
    const publicCalls = handler.mock.calls.filter(
      ([url]) =>
        String(url).includes("/auth/") ||
        String(url).includes("/campaigns/") ||
        String(url).includes("/demo/"),
    );
    expect(publicCalls.every(([, init]) => !new Headers(init?.headers).has("Authorization"))).toBe(
      true,
    );
    const reportCall = handler.mock.calls.find(([url]) => String(url).endsWith("/v1/reports"));
    expect(new Headers(reportCall?.[1]?.headers).get("Authorization")).toBe("Bearer session-0");
    await expect(createLiveClient().listReports()).rejects.toThrow("Sign in");
  });

  it("can sign in again with a persisted public identity", async () => {
    const identities = await client.listIdentities();
    const fresh = createLiveClient();
    await fresh.signIn(JSON.parse(JSON.stringify(identities[0])));
    expect(await fresh.listReports()).toHaveLength(1);
  });

  it("maps report metadata, authenticated findings, replies and the real submission index", async () => {
    await signIn();
    expect((await client.listReports())[0]).toMatchObject({
      campaignTitle: "Test campaign",
      sizeBucket: "128 KB",
      receivedBucket: at,
      unreadReplies: 2,
      pendingAccess: 1,
      headline: null,
    });
    const detail = await client.getReport(reportId);
    expect(detail.analysis).toEqual(data.result);
    expect(detail).toMatchObject({ logIndex: 0, threshold: 2, priceUsd: 0.5 });
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[0]).toMatchObject({ id: "old-question", body: "" });
    expect(detail.messages[1]).toMatchObject({
      body: "Synthetic reply",
      questions: [{ questionId: "Q1", text: "Confirmed" }],
    });
    expect((await client.listReports())[0]).toMatchObject({
      headline: data.result.summary.headline,
      analysis: { claims: data.result.claims.length },
    });
  });

  it.each([null, "queued", "leased", "running", "failed", "dead"])(
    "maps analysis state %s",
    async (status) => {
      await signIn();
      data.summary.analysis = status ? { status, job_id: jobId, updated_at: at } : null;
      expect((await client.listReports())[0]?.analysis.status).toBe(
        status === "leased" ? "running" : (status ?? "none"),
      );
    },
  );

  it("rejects tampered findings", async () => {
    await signIn();
    data.report.findings!.findings_sha256 = "0".repeat(64);
    await expect(client.getReport(reportId)).rejects.toThrow("Findings digest mismatch");
  });

  it("quotes 402, builds the SDK payment, reads settlement headers and maps chunked SSE", async () => {
    await signIn();
    const quote = await client.quoteAnalysis(reportId);
    expect(quote).toMatchObject({
      amountUsd: 0.5,
      assetSymbol: "USDC",
      maxAmountRequired: "500000",
    });
    const events: StageEvent[] = [];
    const run = await client.payAndRunAnalysis(reportId, quote, (event) => events.push(event));
    expect(run.receipt).toMatchObject({ txRef: "mock-settlement", amountUsd: 0.5, mode: "mock" });
    expect(await run.done).toEqual(data.result);
    expect(events).toEqual([
      {
        job_id: jobId,
        stage: "segment",
        status: "started",
        at,
        detail: "",
        progress: null,
        provider: null,
        model: null,
      },
    ]);
    const paid = handler.mock.calls.find(([, init]) => new Headers(init?.headers).has("X-PAYMENT"));
    const headers = new Headers(paid?.[1]?.headers);
    const payment = JSON.parse(atob(headers.get("X-PAYMENT")!));
    expect(payment.payload.mock).toBe(true);
    expect(headers.has("Idempotency-Key")).toBe(true);
    const stream = handler.mock.calls.find(([url]) => String(url).includes("/events"));
    expect(String(stream?.[0])).not.toContain("access_token");
    expect(new Headers(stream?.[1]?.headers).get("Authorization")).toBe("Bearer session-0");
  });

  it.each(["failed", "dead"])("rejects completion when the job is %s", async (status) => {
    await signIn();
    stageStatus = status;
    const quote = await client.quoteAnalysis(reportId);
    const run = await client.payAndRunAnalysis(reportId, quote, () => undefined);
    await expect(run.done).rejects.toThrow("worker_exhausted");
  });

  it("does not return stale findings for a different completed job", async () => {
    await signIn();
    data.report.findings!.job_id = "old-job";
    const run = await client.payAndRunAnalysis(
      reportId,
      await client.quoteAnalysis(reportId),
      () => undefined,
    );
    await expect(run.done).rejects.toThrow("Completed job findings are unavailable");
  });

  it("rejects a modified or cross-report payment quote before charging", async () => {
    await signIn();
    const quote = await client.quoteAnalysis(reportId);
    await expect(client.payAndRunAnalysis("other", quote, () => undefined)).rejects.toThrow(
      "fresh analysis quote",
    );
    quote.amountUsd = 0.01;
    await expect(client.payAndRunAnalysis(reportId, quote, () => undefined)).rejects.toThrow(
      "fresh analysis quote",
    );
    expect(handler.mock.calls.some(([, init]) => new Headers(init?.headers).has("X-PAYMENT"))).toBe(
      false,
    );
  });

  it("reuses payment authorization and idempotency after an ambiguous request", async () => {
    await signIn();
    const quote = await client.quoteAnalysis(reportId);
    handler.mockRejectedValueOnce(new TypeError("Network unavailable"));
    await expect(client.payAndRunAnalysis(reportId, quote, () => undefined)).rejects.toThrow(
      "Network unavailable",
    );
    const run = await client.payAndRunAnalysis(reportId, quote, () => undefined);
    await run.done;
    const attempts = handler.mock.calls.filter(([, init]) =>
      new Headers(init?.headers).has("X-PAYMENT"),
    );
    expect(attempts).toHaveLength(2);
    expect(new Headers(attempts[0]![1]?.headers).get("X-PAYMENT")).toBe(
      new Headers(attempts[1]![1]?.headers).get("X-PAYMENT"),
    );
    expect(new Headers(attempts[0]![1]?.headers).get("Idempotency-Key")).toBe(
      new Headers(attempts[1]![1]?.headers).get("Idempotency-Key"),
    );
  });

  it("uses an injected wallet for an explicitly advertised testnet quote", async () => {
    await signIn();
    data.requirements.extra.mode = "testnet";
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts") return ["0x0000000000000000000000000000000000000001"];
      if (method === "eth_signTypedData_v4") return `0x${"ab".repeat(65)}`;
      return null;
    });
    vi.stubGlobal("ethereum", { request });
    const run = await client.payAndRunAnalysis(
      reportId,
      await client.quoteAnalysis(reportId),
      () => undefined,
    );
    await run.done;
    expect(run.receipt.mode).toBe("testnet");
    expect(request.mock.calls.map(([args]) => args.method)).toEqual([
      "eth_requestAccounts",
      "wallet_switchEthereumChain",
      "eth_signTypedData_v4",
    ]);
    const paid = handler.mock.calls.find(([, init]) => new Headers(init?.headers).has("X-PAYMENT"));
    const payload = JSON.parse(atob(new Headers(paid?.[1]?.headers).get("X-PAYMENT")!)).payload;
    expect(payload.mock).toBeUndefined();
    expect(payload.authorization.value).toBe("500000");
  });

  it("signs approval with a separate session, combines the quorum, and verifies every evidence file", async () => {
    const identities = await signIn();
    const requested = await client.requestAccess(reportId, "Synthetic review");
    expect(requested.status).toBe("pending");
    await expect(client.unlockEvidence(reportId, requested)).rejects.toThrow("not been granted");
    const granted = await client.approveAccess(requested, identities[1]!);
    expect(granted).toMatchObject({
      status: "granted",
      approvals: [{ approverId: "reviewer-1", approverName: "Reviewer 1", at }],
    });
    const unlocked = await client.unlockEvidence(reportId, granted);
    expect(unlocked.files[0]).toMatchObject({
      name: "synthetic.txt",
      metadataRemoved: [{ field: "Author", preview: "***" }],
    });
    expect(unlocked.pseudonymMap).toEqual(data.manifest.pseudonym_map);
    expect(unlocked.selfRedactionCount).toBe(2);
    expect(
      handler.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith("/files/0") &&
          new Headers(init?.headers).get("Authorization") === "Bearer session-0",
      ),
    ).toBe(true);
    data.fileBox = encryptBox(data.key, utf8("tampered"), context("file/0", reportId));
    await expect(client.unlockEvidence(reportId, granted)).rejects.toThrow(
      "Evidence digest mismatch",
    );
  });

  it("does not trust a forged granted status or client-supplied threshold", async () => {
    await signIn();
    const request = await client.requestAccess(reportId, "Synthetic review");
    await expect(
      client.unlockEvidence(reportId, { ...request, status: "granted", threshold: 1 }),
    ).rejects.toThrow("not been granted");
    await expect(client.unlockEvidence("other", request)).rejects.toThrow("does not belong");
  });

  it("seals follow-ups to the reporter and retains sent text only in the current session", async () => {
    const identities = await signIn();
    const sent = await client.sendQuestions(reportId, "Synthetic question", [
      { questionId: "Q2", text: "Which day?" },
    ]);
    const opened = await openMessage(sentBox, data.inbox);
    expect(opened).toMatchObject({
      kind: "question",
      body: "Synthetic question",
      questions: [{ question_id: "Q2", text: "Which day?" }],
    });
    const posted = handler.mock.calls.find(([url]) => String(url).endsWith("/messages"));
    expect(String(posted?.[1]?.body)).not.toContain("Synthetic question");
    expect(
      (await client.getReport(reportId)).messages.find((message) => message.id === sent.id),
    ).toEqual(sent);
    await client.signIn(identities[1]!);
    data.report.messages = data.report.messages.filter(
      (message) => message.direction === "to_reporter",
    );
    expect(
      (await client.getReport(reportId)).messages.find((message) => message.id === sent.id)?.body,
    ).toBe("");
  });

  it("surfaces the API's error message and updates status", async () => {
    await signIn();
    await client.setStatus(reportId, "investigating");
    expect((await client.listReports())[0]?.status).toBe("investigating");
    handler.mockResolvedValueOnce(failure("Reviewer no longer has access"));
    await expect(client.listReports()).rejects.toThrow("Reviewer no longer has access");
  });

  it("preserves structured 402 errors instead of treating them as payment quotes", async () => {
    await signIn();
    handler.mockResolvedValueOnce(failure("Settlement requires reconciliation", 402));
    await expect(client.quoteAnalysis(reportId)).rejects.toThrow(
      "Settlement requires reconciliation",
    );
  });

  it("requires a settlement receipt and never invents a transaction reference", async () => {
    await signIn();
    const quote = await client.quoteAnalysis(reportId);
    handler.mockResolvedValueOnce(
      json(
        {
          job_id: jobId,
          status: "queued",
          payment: {
            scheme: "exact",
            network: "base-sepolia",
            amount_atomic: "500000",
            status: "settled",
          },
        },
        202,
      ),
    );
    await expect(client.payAndRunAnalysis(reportId, quote, () => undefined)).rejects.toThrow(
      "settlement receipt is unavailable",
    );
  });

  it("does not reuse a quote after switching reviewers", async () => {
    const identities = await signIn();
    const quote = await client.quoteAnalysis(reportId);
    await client.signIn(identities[1]!);
    await expect(client.payAndRunAnalysis(reportId, quote, () => undefined)).rejects.toThrow(
      "fresh analysis quote",
    );
  });

  it("never falls back to mock payment when the server advertises testnet", async () => {
    await signIn();
    data.requirements.extra.mode = "testnet";
    const quote = await client.quoteAnalysis(reportId);
    await expect(client.payAndRunAnalysis(reportId, quote, () => undefined)).rejects.toThrow(
      "Connect a browser wallet",
    );
    expect(handler.mock.calls.some(([, init]) => new Headers(init?.headers).has("X-PAYMENT"))).toBe(
      false,
    );
  });
});

it.skipIf(process.env.CANDOR_E2E !== "1")(
  "checks the live console against local identity and API services",
  async () => {
    const sdk = new CandorClient({ apiUrl, identityUrl });
    const campaign = await sdk.loadCampaign("northwind-ethics");
    const verification = await sdk.startVerification(campaign.campaign_id);
    await sdk.mockVerify(verification.session_id, `console-${crypto.randomUUID()}`);
    const tokens = await sdk.mintTokens(campaign, verification.session_id);
    const bytes = utf8("Synthetic reviewer console evidence.");
    const submission = await buildSubmission({
      campaign,
      token: tokens[0]!,
      variants: ["original"],
      statementKey: "statement",
      files: [
        {
          name: "console.txt",
          mime: "text/plain",
          kind: "text",
          originalSize: bytes.length,
          bytes,
          sha256: toHex(sha256(bytes)),
          metadataRemoved: [],
          metadataRemaining: [],
          text: new TextDecoder().decode(bytes),
          anchorDate: null,
          title: "Synthetic",
        },
      ],
      scrub: {
        documents: [
          { docKey: "statement", text: "Synthetic report." },
          { docKey: "D1", text: "Synthetic evidence." },
        ],
        pseudonymMap: [],
        selfRedactionCount: 0,
        counts: {},
        appliedDetections: 0,
      },
    });
    const submitted = await sdk.submit(submission.body, { jitterMs: 0 });
    const client = createLiveClient();
    const identities = await client.listIdentities();
    await client.signIn(identities[0]!);
    const id = submitted.report_id;
    expect((await client.getReport(id)).summary.reportId).toBe(id);
    await client.setStatus(id, "investigating");
    const requested = await client.requestAccess(id, "Synthetic console integration");
    const granted = await client.approveAccess(requested, identities[1]!);
    expect(granted.status).toBe("granted");
    expect((await client.unlockEvidence(id, granted)).files[0]?.name).toBe("console.txt");
    await client.sendQuestions(id, "Synthetic follow-up", []);
    const inbox = await sdk.signInInbox(submission.codename);
    const thread = await sdk.readInbox(inbox.keys.box);
    expect(thread.find((report) => report.report_id === id)?.messages[0]?.plaintext?.body).toBe(
      "Synthetic follow-up",
    );
    await sdk.reply(id, campaign.reviewers, {
      kind: "reply",
      body: "Synthetic response",
      answers: [],
      sent_at: new Date().toISOString(),
    });
    expect(
      (await client.getReport(id)).messages.some(
        (message) => message.body === "Synthetic response",
      ),
    ).toBe(true);
    const quote = await client.quoteAnalysis(id);
    const events: StageEvent[] = [];
    const run = await client.payAndRunAnalysis(id, quote, (event) => events.push(event));
    expect(run.receipt.mode).toBe("mock");
    const workerToken = process.env.CANDOR_WORKER_TOKEN;
    if (!workerToken)
      throw new Error("An isolated synthetic worker token is required for the live test");
    const worker = async (path: string, body?: unknown): Promise<Response> => {
      const response = await fetch(`${apiUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${workerToken}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Synthetic worker request failed (${response.status})`);
      return response;
    };
    const claimed = (await (await worker("/internal/jobs/claim")).json()) as { job_id: string };
    expect(claimed.job_id).toBe(run.jobId);
    await worker(`/internal/jobs/${run.jobId}/events`, {
      job_id: run.jobId,
      stage: "segment",
      status: "succeeded",
      at: new Date().toISOString(),
    });
    const findingsKey = new Uint8Array(32);
    crypto.getRandomValues(findingsKey);
    const result = {
      ...recordedAnalysis,
      report_id: id,
      campaign_id: campaign.campaign_id,
    } as unknown as AnalysisResult;
    const findingsBytes = utf8(JSON.stringify(result));
    await worker(`/internal/jobs/${run.jobId}/complete`, {
      findings: {
        box: encryptBox(findingsKey, findingsBytes, context("findings", id)),
        findings_sha256: toHex(sha256(findingsBytes)),
        sealed_keys: campaign.reviewers.map((reviewer) => ({
          reviewer_id: reviewer.reviewer_id,
          sealed_key: sealKey(findingsKey, b64u.decode(reviewer.enc_pk)),
        })),
      },
      summary: { stages: [], metrics: {} },
    });
    findingsKey.fill(0);
    expect((await run.done).report_id).toBe(id);
    expect(events.some((event) => event.stage === "segment")).toBe(true);
  },
  120000,
);
