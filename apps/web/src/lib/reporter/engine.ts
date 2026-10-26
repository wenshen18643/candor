"use client";

import type { PseudonymEntry, ScrubResult, StrippedFile } from "@candor/privacy";

import { apiUrl, identityUrl, showcaseMode } from "@/lib/config";

import type {
  BlindToken,
  CampaignInfo,
  Receipt,
  SealStep,
  SelfSession,
  VerificationResult,
} from "./types";

const loadCrypto = () => import("@candor/crypto");
const loadPrivacy = () => import("@candor/privacy");

type ShowcaseKeys = {
  issuer: CryptoKeyPair;
  campaign: CampaignInfo;
};

let showcaseKeys: Promise<ShowcaseKeys> | null = null;
const showcaseNullifiers = new Map<string, number>();

async function buildShowcaseKeys(campaignId: string): Promise<ShowcaseKeys> {
  const crypto = await loadCrypto();
  await crypto.ready();
  const { RSABSSA } = await import("@cloudflare/blindrsa-ts");
  const suite = RSABSSA.SHA384.PSS.Randomized();
  const issuer = await suite.generateKey({
    modulusLength: 2048,
    publicExponent: Uint8Array.from([1, 0, 1]),
  });
  const spki = new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", issuer.publicKey));
  const reviewerNames = ["Avery Chen", "Morgan Ellis", "Riley Park"];
  const reviewers = reviewerNames.map((displayName) => {
    const pair = crypto.generateBoxKeyPair();
    return {
      reviewerId: globalThis.crypto.randomUUID(),
      displayName,
      encPk: crypto.b64u.encode(pair.publicKey),
      keyId: crypto.keyId(pair.publicKey),
    };
  });
  const enclave = crypto.generateBoxKeyPair();
  return {
    issuer,
    campaign: {
      campaignId,
      orgName: "Northwind Health",
      title: campaignId === "northwind-safety" ? "Patient safety" : "Ethics & compliance",
      description:
        "Report suspected fraud, safety risks, data misuse or retaliation at Northwind Health. Reports are read by a three-person ethics panel.",
      threshold: 2,
      reviewers,
      enclave: {
        keyId: crypto.keyId(enclave.publicKey),
        encPk: crypto.b64u.encode(enclave.publicKey),
      },
      issuer: {
        keyId: crypto.toHex(crypto.sha256(spki)).slice(0, 16),
        spki: crypto.b64u.encode(spki),
      },
      mode: "showcase",
    },
  };
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

type CampaignResponse = {
  campaign_id: string;
  org: { slug: string; name: string };
  title: string;
  description: string;
  threshold: number;
  issuer: { key_id: string; spki: string };
  enclave: { key_id: string; enc_pk: string };
  reviewers: { reviewer_id: string; display_name: string; enc_pk: string }[];
};

export async function loadCampaign(campaignId: string): Promise<CampaignInfo> {
  if (showcaseMode) {
    showcaseKeys ??= buildShowcaseKeys(campaignId);
    return (await showcaseKeys).campaign;
  }
  const crypto = await loadCrypto();
  await crypto.ready();
  const data = await json<CampaignResponse>(await fetch(`${apiUrl}/v1/campaigns/${campaignId}`));
  return {
    campaignId: data.campaign_id,
    orgName: data.org.name,
    title: data.title,
    description: data.description,
    threshold: data.threshold,
    reviewers: data.reviewers.map((reviewer) => ({
      reviewerId: reviewer.reviewer_id,
      displayName: reviewer.display_name,
      encPk: reviewer.enc_pk,
      keyId: crypto.keyId(crypto.b64u.decode(reviewer.enc_pk)),
    })),
    enclave: { keyId: data.enclave.key_id, encPk: data.enclave.enc_pk },
    issuer: { keyId: data.issuer.key_id, spki: data.issuer.spki },
    mode: "live",
  };
}

export async function startVerification(campaign: CampaignInfo): Promise<SelfSession> {
  if (campaign.mode === "showcase") {
    return {
      sessionId: globalThis.crypto.randomUUID(),
      scope: `candor-${campaign.campaignId}`,
      endpoint: "",
      userId: globalThis.crypto.randomUUID(),
      mode: "mock",
    };
  }
  const data = await json<{
    session_id: string;
    self: { mode: SelfSession["mode"]; scope: string; endpoint: string; user_id: string };
  }>(
    await fetch(`${identityUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaign_id: campaign.campaignId }),
    }),
  );
  return {
    sessionId: data.session_id,
    scope: data.self.scope,
    endpoint: data.self.endpoint,
    userId: data.self.user_id,
    mode: data.self.mode,
  };
}

export async function mockVerify(
  campaign: CampaignInfo,
  session: SelfSession,
  persona: string,
): Promise<VerificationResult> {
  if (campaign.mode === "showcase") {
    await new Promise((resolve) => setTimeout(resolve, 900));
    const key = `${session.scope}:${persona}`;
    const used = showcaseNullifiers.get(key) ?? 0;
    if (used >= 3) return { status: "rejected", reason: "quota_exhausted" };
    return { status: "verified", allowance: 3 - used };
  }
  const data = await json<{ status: string; allowance?: number; reason?: string }>(
    await fetch(`${identityUrl}/v1/sessions/${session.sessionId}/mock-verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona }),
    }),
  );
  return data.status === "verified"
    ? { status: "verified", allowance: data.allowance ?? 1 }
    : { status: "rejected", reason: data.reason ?? "rejected" };
}

export async function pollVerification(session: SelfSession): Promise<VerificationResult | null> {
  const data = await json<{ status: string; allowance?: number; reason?: string }>(
    await fetch(`${identityUrl}/v1/sessions/${session.sessionId}`),
  );
  if (data.status === "verified") return { status: "verified", allowance: data.allowance ?? 1 };
  if (data.status === "rejected") return { status: "rejected", reason: data.reason ?? "rejected" };
  return null;
}

export async function mintTokens(
  campaign: CampaignInfo,
  session: SelfSession,
  count: number,
  persona: string,
): Promise<{ tokens: BlindToken[]; blinded: string[]; signatures: string[] }> {
  const crypto = await loadCrypto();
  await crypto.ready();
  const prepared = await crypto.prepareBlindTokens(
    campaign.issuer.spki,
    campaign.issuer.keyId,
    count,
  );
  let signatures: string[];
  if (campaign.mode === "showcase") {
    const keys = await showcaseKeys;
    if (!keys) throw new Error("Showcase issuer missing");
    const { RSABSSA } = await import("@cloudflare/blindrsa-ts");
    const suite = RSABSSA.SHA384.PSS.Randomized();
    signatures = await Promise.all(
      prepared.blindedMessages.map(async (message) =>
        crypto.b64u.encode(
          await suite.blindSign(keys.issuer.privateKey, crypto.b64u.decode(message)),
        ),
      ),
    );
    const key = `${session.scope}:${persona}`;
    showcaseNullifiers.set(key, (showcaseNullifiers.get(key) ?? 0) + count);
  } else {
    const data = await json<{ blind_signatures: string[] }>(
      await fetch(`${identityUrl}/v1/sessions/${session.sessionId}/issue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blinded_messages: prepared.blindedMessages }),
      }),
    );
    signatures = data.blind_signatures;
  }
  const tokens = await prepared.finalize(signatures);
  return { tokens, blinded: prepared.blindedMessages, signatures };
}

export async function processFiles(files: File[]): Promise<StrippedFile[]> {
  const privacy = await loadPrivacy();
  return Promise.all(
    files.map(async (file) =>
      privacy.stripAndExtract({
        name: file.name,
        type: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      }),
    ),
  );
}

export const statementKey = "statement";

export function documentKey(index: number) {
  return `D${index + 1}`;
}

export function hasText(file: StrippedFile) {
  return file.kind !== "image" && file.kind !== "unsupported";
}

export async function analyseText(files: StrippedFile[], statement: string, selfTerms: string[]) {
  const privacy = await loadPrivacy();
  const docs = [
    { docKey: statementKey, text: statement },
    ...files.flatMap((file, index) =>
      hasText(file) ? [{ docKey: documentKey(index), text: file.text ?? "" }] : [],
    ),
  ];
  const detections = privacy.detectPii(docs, { selfTerms });
  return { docs, detections };
}

export async function applyRedactions(
  docs: { docKey: string; text: string }[],
  detections: Awaited<ReturnType<typeof analyseText>>["detections"],
  decisions: { detectionId: string; action: "pseudonymise" | "redact" | "keep" }[],
  selfTerms: string[],
) {
  const privacy = await loadPrivacy();
  const result = privacy.scrub(docs, detections, decisions);
  const leakage = privacy.assessLeakage(result, selfTerms);
  return { result, leakage };
}

type SealInput = {
  campaign: CampaignInfo;
  token: BlindToken;
  files: StrippedFile[];
  variants: ("original" | "redacted")[];
  scrubbed: ScrubResult;
  jitterMs: number;
  onStep: (step: SealStep) => void;
};

function bytesOf(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export async function sealAndSubmit(input: SealInput): Promise<Receipt> {
  const crypto = await loadCrypto();
  const privacy = await loadPrivacy();
  await crypto.ready();
  const { campaign, files, scrubbed, onStep } = input;
  const reportId = globalThis.crypto.randomUUID();
  let clock = performance.now();
  const step = async (id: string, label: string, detail: string, values?: SealStep["values"]) => {
    const now = performance.now();
    onStep({ id, label, detail, values, durationMs: Math.round(now - clock) });
    await new Promise((resolve) => setTimeout(resolve, 320));
    clock = performance.now();
  };

  const reportKey = crypto.randomKey();
  await step(
    "key",
    "Generated the report key",
    "256 random bits from your browser's secure random generator. It never leaves this device in readable form.",
  );

  const redactedText = new Map(scrubbed.documents.map((doc) => [doc.docKey, doc.text]));
  const payloadFiles = files.map((file, index) => {
    const variant = input.variants[index] ?? "redacted";
    if (variant === "original" || !file.text)
      return { file, bytes: file.bytes, variant: "original" as const };
    const text = redactedText.get(documentKey(index)) ?? "";
    return { file, bytes: new TextEncoder().encode(text), variant: "redacted" as const };
  });
  const digests = payloadFiles.map((item) => crypto.sha256(item.bytes));
  const evidenceRoot = crypto.toHex(crypto.merkleRoot(digests));
  await step(
    "root",
    "Committed to your evidence",
    "Each file is hashed with SHA-256 and the hashes are combined into a Merkle root. Your receipt carries this root so you can prove later exactly what you sent.",
    [{ label: "Evidence root", value: evidenceRoot }],
  );

  const manifest = {
    v: 1,
    report_id: reportId,
    campaign_id: campaign.campaignId,
    files: payloadFiles.map((item, index) => ({
      index,
      name: item.variant === "redacted" ? `${item.file.name}.redacted.txt` : item.file.name,
      mime: item.variant === "redacted" ? "text/plain" : item.file.mime,
      size: item.bytes.length,
      sha256: crypto.toHex(digests[index] ?? new Uint8Array()),
      variant: item.variant,
      metadata_removed: item.file.metadataRemoved.map((field) => ({
        field: field.field,
        preview: field.value.length > 3 ? `${field.value.slice(0, 2)}***` : "***",
      })),
    })),
    pseudonym_map: scrubbed.pseudonymMap satisfies PseudonymEntry[],
    self_redaction_count: scrubbed.selfRedactionCount,
  };
  const manifestBox = crypto.encryptJson(reportKey, manifest, crypto.context("manifest", reportId));
  const fileBoxes = payloadFiles.map((item, index) => ({
    index,
    box: crypto.encryptBox(reportKey, item.bytes, crypto.context(`file/${index}`, reportId)),
  }));
  const plainBytes =
    payloadFiles.reduce((sum, item) => sum + item.bytes.length, 0) + bytesOf(manifest);
  const sealedBytes =
    fileBoxes.reduce((sum, item) => sum + bytesOf(item.box), 0) + bytesOf(manifestBox);
  await step(
    "encrypt",
    "Encrypted files and manifest",
    "XChaCha20-Poly1305 with a fresh nonce per file. Before encryption each file is padded with Padmé so its size reveals almost nothing about its contents.",
    [
      { label: "Files", value: String(fileBoxes.length) },
      { label: "Plaintext", value: `${plainBytes.toLocaleString()} bytes` },
      { label: "Sealed", value: `${sealedBytes.toLocaleString()} bytes` },
    ],
  );

  const shares = await crypto.splitKey(reportKey, campaign.reviewers.length, campaign.threshold);
  const keyShares = campaign.reviewers.map((reviewer, index) => ({
    reviewer_id: reviewer.reviewerId,
    sealed_share: crypto.sealKey(
      shares[index] ?? new Uint8Array(),
      crypto.b64u.decode(reviewer.encPk),
    ),
  }));
  await step(
    "split",
    `Split the key ${campaign.threshold}-of-${campaign.reviewers.length}`,
    `Shamir secret sharing over GF(256). Each share is sealed to one reviewer's X25519 key. Any ${campaign.threshold} reviewers together can open the originals; one alone cannot, and neither can the server.`,
    campaign.reviewers.map((reviewer) => ({
      label: reviewer.displayName,
      value: `key ${reviewer.keyId.slice(0, 8)}`,
    })),
  );

  const payload = privacy.buildAnalysisPayload({
    reportId,
    campaignId: campaign.campaignId,
    statementKey,
    files,
    scrub: scrubbed,
  });
  const analysisKey = crypto.randomKey();
  const analysisBox = crypto.encryptJson(
    analysisKey,
    payload,
    crypto.context("analysis", reportId),
  );
  const sealedAnalysisKey = crypto.sealKey(analysisKey, crypto.b64u.decode(campaign.enclave.encPk));
  await step(
    "analysis",
    "Sealed the redacted view for analysis",
    "Only the redacted, pseudonymised text is prepared for the AI analysis. It is sealed to the analysis worker's key, which decrypts it in memory only.",
    [
      { label: "Documents", value: String(payload.documents.length) },
      { label: "Worker key", value: campaign.enclave.keyId.slice(0, 8) },
    ],
  );

  const codename = crypto.generateCodename();
  const inbox = await crypto.deriveInboxKeys(codename);
  await step(
    "inbox",
    "Created your private inbox",
    "An 8-word codename from the EFF wordlist (about 103 bits). Argon2id turns it into the keys for your anonymous inbox. Only you will know it.",
  );

  const request = {
    report_id: reportId,
    campaign_id: campaign.campaignId,
    token: input.token,
    evidence_root: evidenceRoot,
    manifest: manifestBox,
    files: fileBoxes,
    key_shares: { scheme: "shamir-gf256", threshold: campaign.threshold, shares: keyShares },
    analysis: {
      enclave_key_id: campaign.enclave.keyId,
      sealed_key: sealedAnalysisKey,
      box: analysisBox,
    },
    inbox: {
      sig_pk: crypto.b64u.encode(inbox.sign.publicKey),
      enc_pk: crypto.b64u.encode(inbox.box.publicKey),
    },
  };

  await new Promise((resolve) => setTimeout(resolve, input.jitterMs));
  await step(
    "jitter",
    "Waited a random delay",
    "A random pause before sending makes it harder to link your submission to the moment you verified.",
    [{ label: "Delay", value: `${(input.jitterMs / 1000).toFixed(1)} s` }],
  );

  const body = JSON.stringify(request);
  if (campaign.mode === "showcase") {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await step(
      "submit",
      "Redeemed one unlinkable token",
      "Showcase mode: everything above ran for real in your browser, but nothing was sent. With a backend, the server verifies the RSA blind signature and stores only ciphertext.",
      [{ label: "Request size", value: `${body.length.toLocaleString()} bytes` }],
    );
    const logIndex = 40 + Math.floor(Math.random() * 20);
    return {
      reportId,
      codename,
      evidenceRoot,
      logIndex,
      treeSize: logIndex + 1,
      rootHash: crypto.toHex(crypto.sha256(new TextEncoder().encode(body))),
      submittedAt: new Date().toISOString(),
      bytesSent: body.length,
    };
  }

  const response = await json<{
    report_id: string;
    receipt: {
      evidence_root: string;
      log_index: number;
      sth: { tree_size: number; root_hash: string };
    };
  }>(
    await fetch(`${apiUrl}/v1/reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
  await step(
    "submit",
    "Redeemed one unlinkable token",
    "The server verified the RSA blind signature, recorded the token as spent, stored only ciphertext and appended your evidence root to the public transparency log.",
    [{ label: "Log index", value: String(response.receipt.log_index) }],
  );
  return {
    reportId: response.report_id,
    codename,
    evidenceRoot: response.receipt.evidence_root,
    logIndex: response.receipt.log_index,
    treeSize: response.receipt.sth.tree_size,
    rootHash: response.receipt.sth.root_hash,
    submittedAt: new Date().toISOString(),
    bytesSent: body.length,
  };
}
