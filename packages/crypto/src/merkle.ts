import { sha256 as hash } from "@noble/hashes/sha2.js";

import { b64u, fromHex, utf8 } from "./encoding.js";
import { keyId, verifyDetached } from "./envelopes.js";

export const sha256 = (bytes: Uint8Array): Uint8Array => hash(bytes);
export const leafHash = (data: Uint8Array): Uint8Array =>
  hash
    .create()
    .update(new Uint8Array([0]))
    .update(data)
    .digest();
export const nodeHash = (left: Uint8Array, right: Uint8Array): Uint8Array =>
  hash
    .create()
    .update(new Uint8Array([1]))
    .update(left)
    .update(right)
    .digest();
const equal = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);
const validSize = (size: number): boolean => Number.isSafeInteger(size) && size >= 0;

export function merkleRoot(leaves: Uint8Array[]): Uint8Array {
  if (!leaves.length) return sha256(new Uint8Array());
  if (leaves.length === 1) return leafHash(leaves[0]!);
  const split = 2 ** Math.floor(Math.log2(leaves.length - 1));
  return nodeHash(merkleRoot(leaves.slice(0, split)), merkleRoot(leaves.slice(split)));
}

export function verifyInclusion(
  leaf: Uint8Array,
  index: number,
  treeSize: number,
  path: Uint8Array[],
  root: Uint8Array,
): boolean {
  if (
    !validSize(index) ||
    !validSize(treeSize) ||
    index >= treeSize ||
    root.length !== 32 ||
    path.some((p) => p.length !== 32)
  )
    return false;
  let current = leafHash(leaf);
  let last = treeSize - 1;
  for (const sibling of path) {
    if (last === 0) return false;
    if (index % 2 === 1 || index === last) {
      current = nodeHash(sibling, current);
      while (index !== 0 && index % 2 === 0) {
        index = Math.floor(index / 2);
        last = Math.floor(last / 2);
      }
    } else current = nodeHash(current, sibling);
    index = Math.floor(index / 2);
    last = Math.floor(last / 2);
  }
  return last === 0 && equal(current, root);
}

export function verifyConsistency(
  first: number,
  second: number,
  firstRoot: Uint8Array,
  secondRoot: Uint8Array,
  proof: Uint8Array[],
): boolean {
  if (
    !validSize(first) ||
    !validSize(second) ||
    first > second ||
    firstRoot.length !== 32 ||
    secondRoot.length !== 32 ||
    proof.some((p) => p.length !== 32)
  )
    return false;
  if (first === second) return proof.length === 0 && equal(firstRoot, secondRoot);
  if (first === 0) return proof.length === 0 && equal(firstRoot, merkleRoot([]));
  let oldIndex = first - 1;
  let newIndex = second - 1;
  while (oldIndex % 2 === 1) {
    oldIndex = Math.floor(oldIndex / 2);
    newIndex = Math.floor(newIndex / 2);
  }
  let offset = oldIndex === 0 ? 0 : 1;
  let oldHash = oldIndex === 0 ? firstRoot : proof[0];
  if (!oldHash) return false;
  let newHash = oldHash;
  for (; offset < proof.length; offset++) {
    const sibling = proof[offset]!;
    if (newIndex === 0) return false;
    if (oldIndex % 2 === 1 || oldIndex === newIndex) {
      oldHash = nodeHash(sibling, oldHash);
      newHash = nodeHash(sibling, newHash);
      while (oldIndex !== 0 && oldIndex % 2 === 0) {
        oldIndex = Math.floor(oldIndex / 2);
        newIndex = Math.floor(newIndex / 2);
      }
    } else newHash = nodeHash(newHash, sibling);
    oldIndex = Math.floor(oldIndex / 2);
    newIndex = Math.floor(newIndex / 2);
  }
  return newIndex === 0 && equal(oldHash, firstRoot) && equal(newHash, secondRoot);
}

export type SignedTreeHead = {
  tree_size: number;
  root_hash: string;
  timestamp: string;
  key_id: string;
  signature: string;
};
export const sthMessage = (
  sth: Pick<SignedTreeHead, "tree_size" | "root_hash" | "timestamp">,
): Uint8Array => utf8(`candor/v1/sth\n${sth.tree_size}\n${sth.root_hash}\n${sth.timestamp}`);
export function verifySth(sth: SignedTreeHead, logPublicKey: Uint8Array): boolean {
  try {
    return (
      validSize(sth.tree_size) &&
      fromHex(sth.root_hash).length === 32 &&
      sth.key_id === keyId(logPublicKey) &&
      /^\d{4}-\d{2}-\d{2}T.*Z$/.test(sth.timestamp) &&
      Number.isFinite(Date.parse(sth.timestamp)) &&
      verifyDetached(b64u.decode(sth.signature), sthMessage(sth), logPublicKey)
    );
  } catch {
    return false;
  }
}
export const authMessage = (reviewerId: string, challenge: string): Uint8Array =>
  utf8(`candor/v1/auth\n${reviewerId}\n${challenge}`);
export const inboxAuthMessage = (sigPkB64u: string, challenge: string): Uint8Array =>
  utf8(`candor/v1/inbox-auth\n${sigPkB64u}\n${challenge}`);
export const approvalMessage = (
  requestId: string,
  reportId: string,
  requesterId: string,
): Uint8Array => utf8(`candor/v1/approve\n${requestId}\n${reportId}\n${requesterId}`);
