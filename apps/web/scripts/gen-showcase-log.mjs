import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const outputPath = resolve(here, "../src/data/showcase-log.json");
const analysisPath = resolve(here, "../src/data/showcase-analysis.json");
const vectorsPath = resolve(repoRoot, "docs/specs/vectors/protocol-vectors.json");

const MASK = (1n << 64n) - 1n;
const IV = [
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n,
];
const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];

const rotr = (value, bits) => ((value >> bits) | (value << (64n - bits))) & MASK;

function mix(v, a, b, c, d, x, y) {
  v[a] = (v[a] + v[b] + x) & MASK;
  v[d] = rotr(v[d] ^ v[a], 32n);
  v[c] = (v[c] + v[d]) & MASK;
  v[b] = rotr(v[b] ^ v[c], 24n);
  v[a] = (v[a] + v[b] + y) & MASK;
  v[d] = rotr(v[d] ^ v[a], 16n);
  v[c] = (v[c] + v[d]) & MASK;
  v[b] = rotr(v[b] ^ v[c], 63n);
}

function compress(state, block, counter, last) {
  const v = [...state, ...IV];
  v[12] ^= counter & MASK;
  v[13] ^= counter >> 64n;
  if (last) v[14] ^= MASK;
  const m = Array.from({ length: 16 }, (_, word) => block.readBigUInt64LE(word * 8));
  for (let round = 0; round < 12; round++) {
    const s = SIGMA[round % 10];
    mix(v, 0, 4, 8, 12, m[s[0]], m[s[1]]);
    mix(v, 1, 5, 9, 13, m[s[2]], m[s[3]]);
    mix(v, 2, 6, 10, 14, m[s[4]], m[s[5]]);
    mix(v, 3, 7, 11, 15, m[s[6]], m[s[7]]);
    mix(v, 0, 5, 10, 15, m[s[8]], m[s[9]]);
    mix(v, 1, 6, 11, 12, m[s[10]], m[s[11]]);
    mix(v, 2, 7, 8, 13, m[s[12]], m[s[13]]);
    mix(v, 3, 4, 9, 14, m[s[14]], m[s[15]]);
  }
  for (let i = 0; i < 8; i++) state[i] ^= v[i] ^ v[i + 8];
}

function blake2b(data, outputLength) {
  const state = IV.slice();
  state[0] ^= 0x01010000n ^ BigInt(outputLength);
  const input = Buffer.from(data);
  const blocks = Math.max(1, Math.ceil(input.length / 128));
  for (let index = 0; index < blocks; index++) {
    const block = Buffer.alloc(128);
    input.copy(block, 0, index * 128, Math.min(input.length, (index + 1) * 128));
    const last = index === blocks - 1;
    const counter = BigInt(last ? input.length : (index + 1) * 128);
    compress(state, block, counter, last);
  }
  const out = Buffer.alloc(64);
  state.forEach((word, i) => out.writeBigUInt64LE(word, i * 8));
  return out.subarray(0, outputLength);
}

const sha256 = (...parts) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
};
const b64u = (bytes) => Buffer.from(bytes).toString("base64url");
const keyId = (publicKey) => blake2b(publicKey, 16).toString("hex");

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

const leafHash = (data) => sha256(Buffer.from([0]), data);
const nodeHash = (left, right) => sha256(Buffer.from([1]), left, right);
const splitPoint = (size) => 2 ** Math.floor(Math.log2(size - 1));

function treeHash(leaves) {
  if (leaves.length === 0) return sha256(Buffer.alloc(0));
  if (leaves.length === 1) return leafHash(leaves[0]);
  const k = splitPoint(leaves.length);
  return nodeHash(treeHash(leaves.slice(0, k)), treeHash(leaves.slice(k)));
}

function inclusionPath(index, leaves) {
  if (leaves.length <= 1) return [];
  const k = splitPoint(leaves.length);
  if (index < k) return [...inclusionPath(index, leaves.slice(0, k)), treeHash(leaves.slice(k))];
  return [...inclusionPath(index - k, leaves.slice(k)), treeHash(leaves.slice(0, k))];
}

function subproof(m, leaves, complete) {
  const n = leaves.length;
  if (m === n) return complete ? [] : [treeHash(leaves)];
  const k = splitPoint(n);
  if (m <= k) return [...subproof(m, leaves.slice(0, k), complete), treeHash(leaves.slice(k))];
  return [...subproof(m - k, leaves.slice(k), false), treeHash(leaves.slice(0, k))];
}

function consistencyProof(first, leaves) {
  if (first === 0 || first === leaves.length) return [];
  return subproof(first, leaves, true);
}

function verifyInclusion(leaf, index, size, path, root) {
  if (index >= size) return false;
  let fn = index;
  let sn = size - 1;
  let r = leafHash(leaf);
  for (const p of path) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(p, r);
      while (fn % 2 === 0 && fn !== 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else r = nodeHash(r, p);
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && r.equals(root);
}

function verifyConsistency(first, second, firstRoot, secondRoot, proof) {
  if (first > second) return false;
  if (first === second) return proof.length === 0 && firstRoot.equals(secondRoot);
  if (first === 0) return proof.length === 0;
  if (proof.length === 0) return false;
  const path = Number.isInteger(Math.log2(first)) ? [firstRoot, ...proof] : proof.slice();
  let fn = first - 1;
  let sn = second - 1;
  while (fn % 2 === 1) {
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  let fr = path[0];
  let sr = path[0];
  for (const c of path.slice(1)) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      fr = nodeHash(c, fr);
      sr = nodeHash(c, sr);
      while (fn % 2 === 0 && fn !== 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else sr = nodeHash(sr, c);
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return fr.equals(firstRoot) && sr.equals(secondRoot) && sn === 0;
}

const sthMessage = (size, root, timestamp) =>
  Buffer.from(`candor/v1/sth\n${size}\n${root}\n${timestamp}`, "utf8");

function seedFor(label) {
  return sha256(Buffer.from(`candor/showcase/${label}`, "utf8"));
}

function ed25519FromSeed(seed) {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  return { privateKey, publicKey, raw };
}

function x25519FromSeed(seed) {
  const der = Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return Buffer.from(createPublicKey(privateKey).export({ format: "jwk" }).x, "base64url");
}

function uuidFor(label) {
  const bytes = Buffer.from(seedFor(`uuid/${label}`).subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const hexFor = (label) => seedFor(`hex/${label}`).toString("hex");

function crossCheckVectors() {
  const vectors = JSON.parse(readFileSync(vectorsPath, "utf8"));
  const failures = [];
  const leaves = vectors.merkle.leaves_b64u.map((value) => Buffer.from(value, "base64url"));
  for (const [size, expected] of Object.entries(vectors.merkle.roots)) {
    const actual = treeHash(leaves.slice(0, Number(size))).toString("hex");
    if (actual !== expected) failures.push(`root(${size})`);
  }
  for (const item of vectors.merkle.inclusion) {
    const subset = leaves.slice(0, item.tree_size);
    const path = inclusionPath(item.index, subset).map((value) => value.toString("hex"));
    if (JSON.stringify(path) !== JSON.stringify(item.path))
      failures.push(`inclusion(${item.index},${item.tree_size})`);
    const ok = verifyInclusion(
      leaves[item.index],
      item.index,
      item.tree_size,
      item.path.map((value) => Buffer.from(value, "hex")),
      Buffer.from(vectors.merkle.roots[String(item.tree_size)], "hex"),
    );
    if (!ok) failures.push(`verify inclusion(${item.index},${item.tree_size})`);
  }
  for (const item of vectors.merkle.consistency) {
    const proof = consistencyProof(item.first, leaves.slice(0, item.second)).map((value) =>
      value.toString("hex"),
    );
    if (JSON.stringify(proof) !== JSON.stringify(item.proof))
      failures.push(`consistency(${item.first},${item.second})`);
    const ok = verifyConsistency(
      item.first,
      item.second,
      Buffer.from(vectors.merkle.roots[String(item.first)], "hex"),
      Buffer.from(vectors.merkle.roots[String(item.second)], "hex"),
      item.proof.map((value) => Buffer.from(value, "hex")),
    );
    if (!ok) failures.push(`verify consistency(${item.first},${item.second})`);
  }
  const evidence = vectors.merkle.evidence_root;
  const evidenceRoot = treeHash(evidence.file_sha256.map((value) => Buffer.from(value, "hex")));
  if (evidenceRoot.toString("hex") !== evidence.root) failures.push("evidence_root");
  const keyVector = vectors.key_id;
  if (keyId(Buffer.from(keyVector.public_key_b64u, "base64url")) !== keyVector.key_id)
    failures.push("key_id");
  const sth = vectors.sth_message;
  if (sthMessage(sth.tree_size, sth.root_hash, sth.timestamp).toString("utf8") !== sth.message)
    failures.push("sth_message");
  if (failures.length) {
    console.error(`Protocol vector mismatch: ${failures.join(", ")}`);
    process.exit(1);
  }
  return (
    Object.keys(vectors.merkle.roots).length +
    vectors.merkle.inclusion.length * 2 +
    vectors.merkle.consistency.length * 2 +
    3
  );
}

const analysis = JSON.parse(readFileSync(analysisPath, "utf8"));
const showcaseReport = analysis.report_id;

const reviewers = [
  { key: "avery", display_name: "Avery Chen", role: "admin" },
  { key: "morgan", display_name: "Morgan Ellis", role: "reviewer" },
  { key: "riley", display_name: "Riley Park", role: "auditor" },
].map((reviewer) => {
  const encPk = x25519FromSeed(seedFor(`reviewer/${reviewer.key}/enc`));
  return {
    key: reviewer.key,
    reviewer_id: uuidFor(`reviewer/${reviewer.key}`),
    display_name: reviewer.display_name,
    role: reviewer.role,
    enc_pk: b64u(encPk),
    enc_key_id: keyId(encPk),
  };
});
const reviewer = Object.fromEntries(reviewers.map((item) => [item.key, item.reviewer_id]));

const reportA = uuidFor("report/safety-ladder");
const reportB = uuidFor("report/ethics-overtime");
const jobA = uuidFor("job/a");
const jobB = uuidFor("job/b");
const jobR = uuidFor("job/showcase");
const request1 = uuidFor("access/morgan");
const request2 = uuidFor("access/riley");

const evidenceRoot = (label, files) =>
  treeHash(Array.from({ length: files }, (_, index) => seedFor(`file/${label}/${index}`))).toString(
    "hex",
  );

const findingsDigest = sha256(Buffer.from(canonical(analysis), "utf8")).toString("hex");

const plan = [
  [
    "2026-10-19T08:14:52Z",
    "report.submitted",
    {
      report_id: reportA,
      campaign_id: "northwind-safety",
      evidence_root: evidenceRoot("a", 4),
      bucket: "2026-10-19T08:00:00Z",
    },
  ],
  [
    "2026-10-19T09:02:11Z",
    "report.status_changed",
    { report_id: reportA, status: "triage", actor: reviewer.avery },
  ],
  [
    "2026-10-19T09:05:40Z",
    "analysis.requested",
    { report_id: reportA, job_id: jobA, payment_ref: hexFor("payment/a") },
  ],
  [
    "2026-10-19T09:07:02Z",
    "analysis.completed",
    { report_id: reportA, job_id: jobA, findings_sha256: hexFor("findings/a") },
  ],
  ["2026-10-19T09:31:27Z", "findings.opened", { report_id: reportA, reviewer_id: reviewer.avery }],
  ["2026-10-19T13:48:05Z", "findings.opened", { report_id: reportA, reviewer_id: reviewer.morgan }],
  ["2026-10-20T10:12:44Z", "message.sent", { report_id: reportA, direction: "to_reporter" }],
  [
    "2026-10-21T19:37:09Z",
    "report.submitted",
    {
      report_id: reportB,
      campaign_id: "northwind-ethics",
      evidence_root: evidenceRoot("b", 3),
      bucket: "2026-10-21T19:00:00Z",
    },
  ],
  ["2026-10-21T22:03:51Z", "message.sent", { report_id: reportA, direction: "to_reviewers" }],
  [
    "2026-10-22T08:40:16Z",
    "report.status_changed",
    { report_id: reportB, status: "triage", actor: reviewer.morgan },
  ],
  [
    "2026-10-22T08:44:30Z",
    "analysis.requested",
    { report_id: reportB, job_id: jobB, payment_ref: hexFor("payment/b") },
  ],
  [
    "2026-10-22T08:46:12Z",
    "analysis.completed",
    { report_id: reportB, job_id: jobB, findings_sha256: hexFor("findings/b") },
  ],
  ["2026-10-22T09:15:38Z", "findings.opened", { report_id: reportB, reviewer_id: reviewer.morgan }],
  [
    "2026-10-22T11:20:03Z",
    "report.status_changed",
    { report_id: reportA, status: "investigating", actor: reviewer.avery },
  ],
  [
    "2026-10-23T14:02:47Z",
    "report.status_changed",
    { report_id: reportB, status: "closed", actor: reviewer.avery },
  ],
  [
    "2026-10-24T22:41:19Z",
    "report.submitted",
    {
      report_id: showcaseReport,
      campaign_id: "northwind-ethics",
      evidence_root: evidenceRoot("showcase", 7),
      bucket: "2026-10-24T22:00:00Z",
    },
  ],
  "anchor",
  [
    "2026-10-25T08:05:33Z",
    "report.status_changed",
    { report_id: showcaseReport, status: "triage", actor: reviewer.avery },
  ],
  [
    "2026-10-26T09:39:31Z",
    "analysis.requested",
    { report_id: showcaseReport, job_id: jobR, payment_ref: hexFor("payment/showcase") },
  ],
  [
    "2026-10-26T09:41:13Z",
    "analysis.completed",
    { report_id: showcaseReport, job_id: jobR, findings_sha256: findingsDigest },
  ],
  [
    "2026-10-26T09:44:02Z",
    "findings.opened",
    { report_id: showcaseReport, reviewer_id: reviewer.avery },
  ],
  [
    "2026-10-26T09:52:47Z",
    "findings.opened",
    { report_id: showcaseReport, reviewer_id: reviewer.morgan },
  ],
  ["2026-10-26T10:12:05Z", "message.sent", { report_id: showcaseReport, direction: "to_reporter" }],
  [
    "2026-10-26T10:20:18Z",
    "access.requested",
    { request_id: request1, report_id: showcaseReport, requester_id: reviewer.morgan },
  ],
  [
    "2026-10-26T10:26:41Z",
    "access.approved",
    { request_id: request1, approver_id: reviewer.avery },
  ],
  ["2026-10-26T10:26:41Z", "access.granted", { request_id: request1 }],
  [
    "2026-10-26T10:31:09Z",
    "evidence.fetched",
    { report_id: showcaseReport, reviewer_id: reviewer.morgan, file_index: 0 },
  ],
  [
    "2026-10-26T10:31:12Z",
    "evidence.fetched",
    { report_id: showcaseReport, reviewer_id: reviewer.morgan, file_index: 1 },
  ],
  [
    "2026-10-26T10:33:54Z",
    "evidence.fetched",
    { report_id: showcaseReport, reviewer_id: reviewer.morgan, file_index: 3 },
  ],
  [
    "2026-10-26T10:47:26Z",
    "findings.opened",
    { report_id: showcaseReport, reviewer_id: reviewer.riley },
  ],
  [
    "2026-10-26T10:55:00Z",
    "report.status_changed",
    { report_id: showcaseReport, status: "investigating", actor: reviewer.avery },
  ],
  [
    "2026-10-26T11:02:37Z",
    "access.requested",
    { request_id: request2, report_id: showcaseReport, requester_id: reviewer.riley },
  ],
  "anchor",
  [
    "2026-10-26T11:09:14Z",
    "access.approved",
    { request_id: request2, approver_id: reviewer.morgan },
  ],
  ["2026-10-26T11:09:14Z", "access.granted", { request_id: request2 }],
  [
    "2026-10-26T11:14:48Z",
    "evidence.fetched",
    { report_id: showcaseReport, reviewer_id: reviewer.riley, file_index: 5 },
  ],
  [
    "2026-10-26T11:15:20Z",
    "evidence.fetched",
    { report_id: showcaseReport, reviewer_id: reviewer.riley, file_index: 6 },
  ],
  [
    "2026-10-26T11:52:31Z",
    "report.status_changed",
    { report_id: reportA, status: "closed", actor: reviewer.avery },
  ],
  [
    "2026-10-26T11:58:09Z",
    "findings.opened",
    { report_id: showcaseReport, reviewer_id: reviewer.morgan },
  ],
  [
    "2026-10-26T12:06:43Z",
    "evidence.fetched",
    { report_id: showcaseReport, reviewer_id: reviewer.morgan, file_index: 4 },
  ],
  ["2026-10-26T12:20:56Z", "findings.opened", { report_id: reportB, reviewer_id: reviewer.riley }],
];

const logKey = ed25519FromSeed(seedFor("log-signing-key"));
const logKeyId = keyId(logKey.raw);

function signHead(leaves, timestamp) {
  const size = leaves.length;
  const root = treeHash(leaves).toString("hex");
  const signature = sign(null, sthMessage(size, root, timestamp), logKey.privateKey);
  if (!verify(null, sthMessage(size, root, timestamp), logKey.publicKey, signature)) {
    console.error("Signature self-check failed");
    process.exit(1);
  }
  return {
    tree_size: size,
    root_hash: root,
    timestamp,
    key_id: logKeyId,
    signature: b64u(signature),
  };
}

const leaves = [];
const entries = [];
const anchors = [];
const headsBySize = new Map();

function append(createdAt, type, fields) {
  const entry = { type, ...fields };
  const leaf = Buffer.from(canonical(entry), "utf8");
  entries.push({
    index: leaves.length,
    entry_type: type,
    entry,
    leaf_b64u: b64u(leaf),
    created_at: createdAt,
  });
  leaves.push(leaf);
  headsBySize.set(leaves.length, signHead(leaves, createdAt));
}

for (const step of plan) {
  if (step === "anchor") {
    const head = headsBySize.get(leaves.length);
    const anchor = {
      tree_size: head.tree_size,
      root_hash: head.root_hash,
      chain: "mock",
      tx_ref: `0x${sha256(Buffer.from(head.root_hash, "hex")).toString("hex")}`,
      created_at: head.timestamp,
    };
    anchors.push(anchor);
    append(head.timestamp, "anchor.published", {
      tree_size: anchor.tree_size,
      root_hash: anchor.root_hash,
      chain: anchor.chain,
      tx_ref: anchor.tx_ref,
    });
    continue;
  }
  const [createdAt, type, fields] = step;
  append(createdAt, type, fields);
}

const latestSize = leaves.length;
const checkpointSizes = [9, ...anchors.map((anchor) => anchor.tree_size), latestSize];
const treeHeads = checkpointSizes.map((size) => headsBySize.get(size));
const latest = treeHeads.at(-1);
const latestRoot = Buffer.from(latest.root_hash, "hex");

const inclusion = entries.map((item) => {
  const path = inclusionPath(item.index, leaves);
  if (!verifyInclusion(leaves[item.index], item.index, latestSize, path, latestRoot)) {
    console.error(`Inclusion self-check failed for ${item.index}`);
    process.exit(1);
  }
  return {
    index: item.index,
    tree_size: latestSize,
    leaf_hash: leafHash(leaves[item.index]).toString("hex"),
    audit_path: path.map((value) => value.toString("hex")),
  };
});

const consistency = [];
for (let i = 0; i < checkpointSizes.length; i++) {
  for (let j = i + 1; j < checkpointSizes.length; j++) {
    const first = checkpointSizes[i];
    const second = checkpointSizes[j];
    const proof = consistencyProof(first, leaves.slice(0, second));
    const ok = verifyConsistency(
      first,
      second,
      Buffer.from(headsBySize.get(first).root_hash, "hex"),
      Buffer.from(headsBySize.get(second).root_hash, "hex"),
      proof,
    );
    if (!ok) {
      console.error(`Consistency self-check failed for ${first} -> ${second}`);
      process.exit(1);
    }
    consistency.push({ first, second, proof: proof.map((value) => value.toString("hex")) });
  }
}

const tamperedLeaf = Buffer.from(leaves[0]);
tamperedLeaf[tamperedLeaf.length - 3] ^= 0x01;
if (verifyInclusion(tamperedLeaf, 0, latestSize, inclusionPath(0, leaves), latestRoot)) {
  console.error("Tamper self-check failed: altered leaf still verified");
  process.exit(1);
}

const checked = crossCheckVectors();

const output = {
  version: 1,
  generated_by: "apps/web/scripts/gen-showcase-log.mjs",
  note: "Showcase transparency log. Deterministic demo keys; RFC 9162 hashing and Ed25519 tree-head signatures are real.",
  log: { key_id: logKeyId, public_key: b64u(logKey.raw) },
  showcase_report_id: showcaseReport,
  campaigns: [
    { campaign_id: "northwind-ethics", title: "Northwind Health ethics line" },
    { campaign_id: "northwind-safety", title: "Northwind Health safety line" },
  ],
  reviewers: reviewers.map(({ key: _key, ...rest }) => rest),
  entries,
  tree_heads: treeHeads,
  inclusion,
  consistency,
  anchors,
};

writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(
  `Wrote ${entries.length} entries, ${treeHeads.length} signed tree heads, ${consistency.length} consistency proofs, ${anchors.length} anchors.
`,
);
process.stdout.write(`Latest root ${latest.root_hash} at size ${latestSize}; log key ${logKeyId}.
`);
process.stdout.write(`Cross-checked ${checked} protocol vector assertions.
`);
