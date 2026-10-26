import type { CandorBox, KeyPair, SealBox } from "@candor/crypto";
import {
  approvalMessage,
  b64u,
  combineShares,
  context,
  decryptBox,
  decryptJson,
  fromHex,
  merkleRoot,
  openSealedKey,
  openSealJson,
  ready,
  sealJson,
  sealKey,
  sha256,
  signDetached,
  toHex,
} from "@candor/crypto";
import type { PseudonymEntry } from "@candor/privacy";

import type { AnalysisResult } from "./contracts.generated.js";
import type { InboxQuestion, InboxReply, Manifest, ManifestFile, Schemas } from "./types.js";

export async function openFindings(
  reportId: string,
  findings: Schemas["Findings"],
  keys: KeyPair,
): Promise<AnalysisResult> {
  await ready();
  const key = openSealedKey(findings.sealed_key, keys.publicKey, keys.privateKey);
  try {
    const bytes = decryptBox(key, findings.box, context("findings", reportId));
    if (toHex(sha256(bytes)) !== findings.findings_sha256)
      throw new Error("Findings digest mismatch");
    const result = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as AnalysisResult;
    if (result.version !== 1 || result.report_id !== reportId)
      throw new Error("Findings identity mismatch");
    return result;
  } finally {
    key.fill(0);
  }
}

export async function createApproval(args: {
  request: Pick<Schemas["ListedAccess"], "id" | "report_id" | "requester_id" | "requester_enc_pk">;
  sealedShare: string;
  boxKeys: KeyPair;
  signPrivateKey: Uint8Array;
}): Promise<Schemas["Approval"]> {
  await ready();
  const { request, boxKeys } = args;
  const share = openSealedKey(args.sealedShare, boxKeys.publicKey, boxKeys.privateKey);
  try {
    return {
      resealed_share: sealKey(share, b64u.decode(request.requester_enc_pk)),
      signature: b64u.encode(
        signDetached(
          approvalMessage(request.id, request.report_id, request.requester_id),
          args.signPrivateKey,
        ),
      ),
    };
  } finally {
    share.fill(0);
  }
}

export async function combineReportShares(
  sealedShares: string[],
  keys: KeyPair,
  threshold: number,
): Promise<Uint8Array> {
  await ready();
  if (!Number.isInteger(threshold) || threshold < 2 || sealedShares.length < threshold)
    throw new Error("Insufficient quorum");
  const shares: Uint8Array[] = [];
  try {
    for (const share of sealedShares)
      shares.push(openSealedKey(share, keys.publicKey, keys.privateKey));
    if (new Set(shares.map((share) => share[32])).size !== shares.length)
      throw new Error("Duplicate share");
    return await combineShares(shares);
  } finally {
    shares.forEach((share) => share.fill(0));
  }
}

export async function decryptManifest(
  reportId: string,
  box: CandorBox,
  key: Uint8Array,
  evidenceRoot?: string,
): Promise<Manifest> {
  await ready();
  const manifest = decryptJson<Manifest>(key, box, context("manifest", reportId));
  if (manifest.v !== 1 || manifest.report_id !== reportId || !Array.isArray(manifest.files))
    throw new Error("Manifest identity mismatch");
  if (manifest.files.some((file, index) => file.index !== index))
    throw new Error("Invalid manifest file order");
  if (
    evidenceRoot &&
    toHex(merkleRoot(manifest.files.map((file) => fromHex(file.sha256)))) !== evidenceRoot
  )
    throw new Error("Evidence root mismatch");
  return manifest;
}

export async function decryptFile(
  reportId: string,
  file: ManifestFile,
  box: CandorBox,
  key: Uint8Array,
): Promise<Uint8Array> {
  await ready();
  const bytes = decryptBox(key, box, context(`file/${file.index}`, reportId));
  if (bytes.length !== file.size || toHex(sha256(bytes)) !== file.sha256)
    throw new Error("Evidence digest mismatch");
  return bytes;
}

export function reidentifyResult(
  result: AnalysisResult,
  pseudonyms: PseudonymEntry[],
): AnalysisResult {
  const names = new Map(pseudonyms.map((entry) => [entry.placeholder, entry.value]));
  const preserve = new Set([
    "entity_id",
    "placeholder",
    "source",
    "target",
    "actors",
    "targets",
    "sha256",
  ]);
  const visit = (value: unknown, field = ""): unknown => {
    if (preserve.has(field) || field.endsWith("_id") || field.endsWith("_ids"))
      return structuredClone(value);
    if (typeof value === "string")
      return value.replace(/\b[A-Z][A-Z_]*_\d+\b/g, (name) => names.get(name) ?? name);
    if (Array.isArray(value)) return value.map((item) => visit(item, field));
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, visit(item, key)]),
      );
    return value;
  };
  return visit(result) as AnalysisResult;
}

export async function sealQuestion(
  message: InboxQuestion,
  inboxPublicKey: string,
): Promise<SealBox> {
  await ready();
  return sealJson(message, b64u.decode(inboxPublicKey));
}

export async function sealReply(
  message: InboxReply,
  reviewers: Schemas["ReviewerPublic"][],
): Promise<Schemas["RecipientBox"][]> {
  await ready();
  return reviewers.map((reviewer) => ({
    reviewer_id: reviewer.reviewer_id,
    box: sealJson(message, b64u.decode(reviewer.enc_pk)),
  }));
}

export async function openMessage(
  box: unknown,
  keys: KeyPair,
): Promise<InboxQuestion | InboxReply> {
  await ready();
  if (
    !box ||
    typeof box !== "object" ||
    !("v" in box) ||
    box.v !== 1 ||
    !("alg" in box) ||
    box.alg !== "seal-padme" ||
    !("c" in box) ||
    typeof box.c !== "string"
  )
    throw new Error("Invalid message envelope");
  const message = openSealJson<InboxQuestion | InboxReply>(
    box as SealBox,
    keys.publicKey,
    keys.privateKey,
  );
  if (!["question", "message", "reply"].includes(message.kind) || typeof message.body !== "string")
    throw new Error("Invalid inbox message");
  return message;
}
