import {
  b64u,
  context,
  deriveInboxKeys,
  encryptBox,
  encryptJson,
  generateCodename,
  keyId,
  merkleRoot,
  randomKey,
  ready,
  sealKey,
  sha256,
  splitKey,
  toHex,
  utf8,
} from "@candor/crypto";
import { buildAnalysisPayload } from "@candor/privacy";

import type { BuildSubmissionInput, BuiltSubmission, Manifest, SealStep } from "./types.js";

function prepareFiles(input: BuildSubmissionInput) {
  const documents = new Map(input.scrub.documents.map((doc) => [doc.docKey, doc.text]));
  if (input.files.length > 256 || input.variants.length !== input.files.length)
    throw new Error("Invalid file variants");
  return input.files.map((file, index) => {
    if (file.kind === "unsupported" || file.metadataRemaining.length)
      throw new Error("Evidence must have metadata stripped before submission");
    const variant = input.variants[index]!;
    if (variant !== "original" && variant !== "redacted") throw new Error("Invalid variant");
    const text = documents.get(file.name) ?? documents.get(`D${index + 1}`);
    if (variant === "redacted" && (text === undefined || file.text === null))
      throw new Error("Redacted variant requires scrubbed text");
    const bytes = variant === "redacted" ? utf8(text!) : file.bytes;
    return { file, index, variant, bytes, digest: sha256(bytes) };
  });
}

export async function buildSubmission(input: BuildSubmissionInput): Promise<BuiltSubmission> {
  await ready();
  const { campaign } = input;
  if (new Set(campaign.reviewers.map((r) => r.reviewer_id)).size !== campaign.reviewers.length)
    throw new Error("Duplicate reviewers");
  if (input.token.key_id !== campaign.issuer.key_id) throw new Error("Issuer key mismatch");
  if (keyId(b64u.decode(campaign.enclave.enc_pk)) !== campaign.enclave.key_id)
    throw new Error("Enclave key mismatch");
  const files = prepareFiles(input);
  const reportId = globalThis.crypto.randomUUID();
  const payload = buildAnalysisPayload({
    reportId,
    campaignId: campaign.campaign_id,
    statementKey: input.statementKey,
    files: input.files,
    scrub: input.scrub,
  });
  const step = (id: SealStep["id"], data: SealStep["data"]): void => input.onStep?.({ id, data });
  const reportKey = randomKey();
  const analysisKey = randomKey();
  let shares: Uint8Array[] = [];
  try {
    step("key", { bits: 256 });
    const evidenceRoot = toHex(merkleRoot(files.map((file) => file.digest)));
    step("root", { evidence_root: evidenceRoot, file_count: files.length });
    const manifest: Manifest = {
      v: 1,
      report_id: reportId,
      campaign_id: campaign.campaign_id,
      files: files.map(({ file, index, variant, bytes, digest }) => ({
        index,
        name: variant === "redacted" ? `${file.name}.redacted.txt` : file.name,
        mime: variant === "redacted" ? "text/plain" : file.mime,
        size: bytes.length,
        sha256: toHex(digest),
        variant,
        metadata_removed: file.metadataRemoved.map(({ field }) => ({ field, preview: "***" })),
      })),
      pseudonym_map: input.scrub.pseudonymMap,
      self_redaction_count: input.scrub.selfRedactionCount,
    };
    const manifestBox = encryptJson(reportKey, manifest, context("manifest", reportId));
    const boxes = files.map(({ index, bytes }) => ({
      index,
      box: encryptBox(reportKey, bytes, context(`file/${index}`, reportId)),
    }));
    step("encrypt", {
      file_count: files.length,
      plaintext_bytes: files.reduce(
        (n, file) => n + file.bytes.length,
        utf8(JSON.stringify(manifest)).length,
      ),
      sealed_bytes: boxes.reduce(
        (n, file) => n + b64u.decode(file.box.c).length,
        b64u.decode(manifestBox.c).length,
      ),
    });
    shares = await splitKey(reportKey, campaign.reviewers.length, campaign.threshold);
    const sealedShares = campaign.reviewers.map((reviewer, index) => ({
      reviewer_id: reviewer.reviewer_id,
      sealed_share: sealKey(shares[index]!, b64u.decode(reviewer.enc_pk)),
    }));
    step("split", {
      threshold: campaign.threshold,
      reviewer_count: campaign.reviewers.length,
      ...Object.fromEntries(
        campaign.reviewers.map((r, i) => [`reviewer_key_id_${i}`, keyId(b64u.decode(r.enc_pk))]),
      ),
    });
    const analysis = {
      enclave_key_id: campaign.enclave.key_id,
      sealed_key: sealKey(analysisKey, b64u.decode(campaign.enclave.enc_pk)),
      box: encryptJson(analysisKey, payload, context("analysis", reportId)),
    };
    step("analysis", {
      worker_key_id: campaign.enclave.key_id,
      document_count: payload.documents.length,
      sealed_bytes: b64u.decode(analysis.box.c).length,
    });
    const codename = generateCodename(8);
    const inboxKeys = await deriveInboxKeys(codename);
    const inbox = {
      sig_pk: b64u.encode(inboxKeys.sign.publicKey),
      enc_pk: b64u.encode(inboxKeys.box.publicKey),
    };
    inboxKeys.sign.privateKey.fill(0);
    inboxKeys.box.privateKey.fill(0);
    step("inbox", { words: 8 });
    return {
      codename,
      body: {
        report_id: reportId,
        campaign_id: campaign.campaign_id,
        token: input.token,
        evidence_root: evidenceRoot,
        manifest: manifestBox,
        files: boxes,
        key_shares: { scheme: "shamir-gf256", threshold: campaign.threshold, shares: sealedShares },
        analysis,
        inbox,
      },
    };
  } finally {
    reportKey.fill(0);
    analysisKey.fill(0);
    shares.forEach((share) => share.fill(0));
  }
}
