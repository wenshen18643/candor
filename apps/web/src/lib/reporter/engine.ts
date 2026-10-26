"use client";

import type { BlindToken } from "@candor/crypto";
import type { ScrubResult, StrippedFile } from "@candor/privacy";
import type { Campaign, CandorClient, SealStep as BuilderStep } from "@candor/sdk";

import { apiUrl, identityUrl, showcaseMode } from "@/lib/config";

import type { CampaignInfo, Receipt, SealStep, SelfSession, VerificationResult } from "./types";

const loadCrypto = () => import("@candor/crypto");
const loadPrivacy = () => import("@candor/privacy");
const loadSdk = () => import("@candor/sdk");

let client: Promise<CandorClient> | null = null;

function liveClient() {
  client ??= loadSdk().then((sdk) => new sdk.CandorClient({ apiUrl, identityUrl }));
  return client;
}

type ShowcaseState = { issuer: CryptoKeyPair; campaign: CampaignInfo };

let showcase: Promise<ShowcaseState> | null = null;
const showcaseNullifiers = new Map<string, number>();

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function buildShowcase(campaignId: string): Promise<ShowcaseState> {
  const crypto = await loadCrypto();
  await crypto.ready();
  const { RSABSSA } = await import("@cloudflare/blindrsa-ts");
  const issuer = await RSABSSA.SHA384.PSS.Randomized().generateKey({
    modulusLength: 2048,
    publicExponent: Uint8Array.from([1, 0, 1]),
  });
  const spki = new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", issuer.publicKey));
  const enclave = crypto.generateBoxKeyPair();
  const descriptor: Campaign = {
    campaign_id: campaignId,
    org: { slug: "northwind", name: "Northwind Health" },
    title: campaignId === "northwind-safety" ? "Patient safety" : "Ethics & compliance",
    description:
      "Report suspected fraud, safety risks, data misuse or retaliation at Northwind Health. Reports are read by a three-person ethics panel.",
    threshold: 2,
    analysis_price_usd: "0.50",
    identity_url: "",
    issuer: {
      key_id: crypto.toHex(crypto.sha256(spki)).slice(0, 16),
      spki: crypto.b64u.encode(spki),
    },
    enclave: {
      key_id: crypto.keyId(enclave.publicKey),
      enc_pk: crypto.b64u.encode(enclave.publicKey),
    },
    reviewers: ["Avery Chen", "Morgan Ellis", "Riley Park"].map((display_name) => ({
      reviewer_id: globalThis.crypto.randomUUID(),
      display_name,
      enc_pk: crypto.b64u.encode(crypto.generateBoxKeyPair().publicKey),
    })),
  };
  return { issuer, campaign: await describeCampaign(descriptor, "showcase") };
}

async function describeCampaign(
  descriptor: Campaign,
  mode: CampaignInfo["mode"],
): Promise<CampaignInfo> {
  const crypto = await loadCrypto();
  await crypto.ready();
  return {
    campaignId: descriptor.campaign_id,
    orgName: descriptor.org.name,
    title: descriptor.title,
    description: descriptor.description,
    threshold: descriptor.threshold,
    reviewers: descriptor.reviewers.map((reviewer) => ({
      reviewerId: reviewer.reviewer_id,
      displayName: reviewer.display_name,
      encPk: reviewer.enc_pk,
      keyId: crypto.keyId(crypto.b64u.decode(reviewer.enc_pk)),
    })),
    enclave: { keyId: descriptor.enclave.key_id, encPk: descriptor.enclave.enc_pk },
    issuer: { keyId: descriptor.issuer.key_id, spki: descriptor.issuer.spki },
    mode,
    descriptor,
  };
}

export async function loadCampaign(campaignId: string): Promise<CampaignInfo> {
  if (showcaseMode) {
    showcase ??= buildShowcase(campaignId);
    return (await showcase).campaign;
  }
  const sdk = await liveClient();
  return describeCampaign(await sdk.loadCampaign(campaignId), "live");
}

export async function startVerification(campaign: CampaignInfo): Promise<SelfSession> {
  if (campaign.mode === "showcase")
    return {
      sessionId: globalThis.crypto.randomUUID(),
      scope: `candor-${campaign.campaignId}`,
      endpoint: "",
      userId: globalThis.crypto.randomUUID(),
      mode: "mock",
    };
  const session = await (await liveClient()).startVerification(campaign.campaignId);
  return {
    sessionId: session.session_id,
    scope: session.self.scope,
    endpoint: session.self.endpoint,
    userId: session.self.user_id,
    mode: session.self.mode,
  };
}

function verdict(status: string, allowance: number, reason: string | null): VerificationResult {
  return status === "verified"
    ? { status: "verified", allowance }
    : { status: "rejected", reason: reason ?? status };
}

export async function mockVerify(
  campaign: CampaignInfo,
  session: SelfSession,
  persona: string,
): Promise<VerificationResult> {
  if (campaign.mode === "showcase") {
    await pause(900);
    const used = showcaseNullifiers.get(`${session.scope}:${persona}`) ?? 0;
    return used >= 3
      ? { status: "rejected", reason: "quota_exhausted" }
      : { status: "verified", allowance: 3 - used };
  }
  const result = await (await liveClient()).mockVerify(session.sessionId, persona);
  return verdict(result.status, result.allowance, result.reason);
}

export async function pollVerification(session: SelfSession): Promise<VerificationResult | null> {
  const result = await (await liveClient()).pollVerification(session.sessionId);
  if (result.status === "pending") return null;
  return verdict(result.status, result.allowance, result.reason);
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
    const state = await showcase;
    if (!state) throw new Error("Demo issuer is not ready");
    const { RSABSSA } = await import("@cloudflare/blindrsa-ts");
    const suite = RSABSSA.SHA384.PSS.Randomized();
    signatures = await Promise.all(
      prepared.blindedMessages.map(async (message) =>
        crypto.b64u.encode(
          await suite.blindSign(state.issuer.privateKey, crypto.b64u.decode(message)),
        ),
      ),
    );
    const key = `${session.scope}:${persona}`;
    showcaseNullifiers.set(key, (showcaseNullifiers.get(key) ?? 0) + count);
  } else {
    const issued = await (
      await liveClient()
    ).issueBlindTokens(session.sessionId, prepared.blindedMessages);
    if (issued.key_id !== campaign.issuer.keyId) throw new Error("The issuer key changed");
    signatures = issued.blind_signatures;
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
  return { docs, detections: privacy.detectPii(docs, { selfTerms }) };
}

export async function applyRedactions(
  docs: { docKey: string; text: string }[],
  detections: Awaited<ReturnType<typeof analyseText>>["detections"],
  decisions: { detectionId: string; action: "pseudonymise" | "redact" | "keep" }[],
  selfTerms: string[],
) {
  const privacy = await loadPrivacy();
  const result = privacy.scrub(docs, detections, decisions);
  return { result, leakage: privacy.assessLeakage(result, selfTerms) };
}

function bytes(value: number | string | undefined) {
  return `${Number(value ?? 0).toLocaleString()} bytes`;
}

function describe(step: BuilderStep, campaign: CampaignInfo): Omit<SealStep, "durationMs"> {
  const data = step.data;
  switch (step.id) {
    case "key":
      return {
        id: step.id,
        label: "Generated the report key",
        detail:
          "256 random bits from your browser's secure random generator. It never leaves this device in readable form.",
      };
    case "root":
      return {
        id: step.id,
        label: "Committed to your evidence",
        detail:
          "Each file is hashed with SHA-256 and the hashes are combined into a Merkle root. Your receipt carries this root, so you can prove later exactly what you sent.",
        values: [{ label: "Evidence root", value: String(data.evidence_root) }],
      };
    case "encrypt":
      return {
        id: step.id,
        label: "Encrypted files and manifest",
        detail:
          "XChaCha20-Poly1305 with a fresh nonce per file. Each file is first padded with Padmé, so its size reveals almost nothing about its contents.",
        values: [
          { label: "Files", value: String(data.file_count) },
          { label: "Plaintext", value: bytes(data.plaintext_bytes) },
          { label: "Sealed", value: bytes(data.sealed_bytes) },
        ],
      };
    case "split":
      return {
        id: step.id,
        label: `Split the key ${campaign.threshold}-of-${campaign.reviewers.length}`,
        detail: `Shamir secret sharing over GF(256). Each share is sealed to one reviewer's X25519 key. Any ${campaign.threshold} reviewers together can open the originals. One alone cannot, and neither can the server.`,
        values: campaign.reviewers.map((reviewer) => ({
          label: reviewer.displayName,
          value: `key ${reviewer.keyId.slice(0, 8)}`,
        })),
      };
    case "analysis":
      return {
        id: step.id,
        label: "Sealed the hidden-name text for analysis",
        detail:
          "Only the redacted, pseudonymised text goes to the AI analysis. It is sealed to the analysis worker's key, which opens it in memory only.",
        values: [
          { label: "Documents", value: String(data.document_count) },
          { label: "Worker key", value: String(data.worker_key_id).slice(0, 8) },
        ],
      };
    case "inbox":
      return {
        id: step.id,
        label: "Created your private inbox",
        detail:
          "An 8-word codename from the EFF wordlist, about 103 bits. Argon2id turns it into the keys for your anonymous inbox. Only you will know it.",
      };
  }
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

export async function sealAndSubmit(input: SealInput): Promise<Receipt> {
  const sdk = await loadSdk();
  const { campaign, onStep } = input;
  const recorded: { step: BuilderStep; durationMs: number }[] = [];
  let clock = performance.now();
  const built = await sdk.buildSubmission({
    campaign: campaign.descriptor,
    token: input.token,
    files: input.files,
    variants: input.variants,
    scrub: input.scrubbed,
    statementKey,
    onStep: (step) => {
      const now = performance.now();
      recorded.push({ step, durationMs: Math.round(now - clock) });
      clock = now;
    },
  });
  for (const item of recorded) {
    onStep({ ...describe(item.step, campaign), durationMs: item.durationMs });
    await pause(320);
  }
  const body = JSON.stringify(built.body);
  const started = performance.now();

  if (campaign.mode === "showcase") {
    await pause(input.jitterMs);
    onStep({
      id: "jitter",
      label: "Waited a random delay",
      detail:
        "A random pause before sending makes it harder to link your report to the moment you verified.",
      values: [{ label: "Delay", value: `${(input.jitterMs / 1000).toFixed(1)} s` }],
      durationMs: Math.round(performance.now() - started),
    });
    await pause(500);
    onStep({
      id: "submit",
      label: "Redeemed one unlinkable token",
      detail:
        "Demo mode: everything above ran for real in your browser, but nothing was sent. With a backend, the server checks the blind signature, marks the token spent and stores only ciphertext.",
      values: [{ label: "Request size", value: bytes(body.length) }],
      durationMs: 0,
    });
    const crypto = await loadCrypto();
    const logIndex = 40 + Math.floor(Math.random() * 20);
    return {
      reportId: built.body.report_id,
      codename: built.codename,
      evidenceRoot: built.body.evidence_root,
      logIndex,
      treeSize: logIndex + 1,
      rootHash: crypto.toHex(crypto.sha256(crypto.utf8(body))),
      submittedAt: new Date().toISOString(),
      bytesSent: body.length,
    };
  }

  const submitted = await (await liveClient()).submit(built.body, { jitterMs: input.jitterMs });
  const waited = Math.round(performance.now() - started);
  onStep({
    id: "jitter",
    label: "Waited a random delay",
    detail:
      "A random pause before sending makes it harder to link your report to the moment you verified.",
    values: [{ label: "Delay", value: `${(input.jitterMs / 1000).toFixed(1)} s` }],
    durationMs: waited,
  });
  onStep({
    id: "submit",
    label: "Redeemed one unlinkable token",
    detail:
      "The server checked the RSA blind signature, marked the token spent, stored only ciphertext and added your evidence root to the public transparency log.",
    values: [{ label: "Log index", value: String(submitted.receipt.log_index) }],
    durationMs: 0,
  });
  return {
    reportId: submitted.report_id,
    codename: built.codename,
    evidenceRoot: submitted.receipt.evidence_root,
    logIndex: submitted.receipt.log_index,
    treeSize: submitted.receipt.sth.tree_size,
    rootHash: submitted.receipt.sth.root_hash,
    submittedAt: new Date().toISOString(),
    bytesSent: body.length,
  };
}
