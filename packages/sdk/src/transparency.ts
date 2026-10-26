import type { SignedTreeHead } from "@candor/crypto";
import {
  b64u,
  fromHex,
  leafHash,
  ready,
  toHex,
  verifyConsistency,
  verifyInclusion,
  verifySth,
} from "@candor/crypto";

import type { ConsistencyProof, InclusionProof, Schemas, Submitted } from "./types.js";

export async function verifyTreeHead(sth: SignedTreeHead, publicKey: string): Promise<boolean> {
  await ready();
  try {
    return verifySth(sth, b64u.decode(publicKey));
  } catch {
    return false;
  }
}

export async function verifyLogInclusion(
  leaf: string,
  proof: InclusionProof,
  sth: SignedTreeHead,
  publicKey: string,
): Promise<boolean> {
  try {
    return (
      (await verifyTreeHead(sth, publicKey)) &&
      proof.tree_size === sth.tree_size &&
      toHex(leafHash(b64u.decode(leaf))) === proof.leaf_hash &&
      verifyInclusion(
        b64u.decode(leaf),
        proof.index,
        proof.tree_size,
        proof.audit_path.map(fromHex),
        fromHex(sth.root_hash),
      )
    );
  } catch {
    return false;
  }
}

export async function verifyLogConsistency(
  first: SignedTreeHead,
  second: SignedTreeHead,
  proof: ConsistencyProof,
  publicKey: string,
): Promise<boolean> {
  try {
    return (
      (await verifyTreeHead(first, publicKey)) &&
      (await verifyTreeHead(second, publicKey)) &&
      proof.first === first.tree_size &&
      proof.second === second.tree_size &&
      verifyConsistency(
        proof.first,
        proof.second,
        fromHex(first.root_hash),
        fromHex(second.root_hash),
        proof.proof.map(fromHex),
      )
    );
  } catch {
    return false;
  }
}

export async function verifySubmissionReceipt(
  submitted: Submitted,
  entry: Schemas["LogEntry"],
  proof: InclusionProof,
  publicKey: string,
): Promise<boolean> {
  try {
    const leaf = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(b64u.decode(entry.leaf_b64u)),
    ) as Record<string, unknown>;
    return (
      entry.index === submitted.receipt.log_index &&
      proof.index === entry.index &&
      leaf.report_id === submitted.report_id &&
      leaf.evidence_root === submitted.receipt.evidence_root &&
      leaf.type === "report.submitted" &&
      (await verifyLogInclusion(entry.leaf_b64u, proof, submitted.receipt.sth, publicKey))
    );
  } catch {
    return false;
  }
}
