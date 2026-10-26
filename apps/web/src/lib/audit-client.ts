import type * as Crypto from "@candor/crypto";
import type { SignedTreeHead } from "@candor/crypto";

import { apiUrl, defaultCampaign, showcaseMode } from "./config";

export type { SignedTreeHead };

export const logEntryTypes = [
  "report.submitted",
  "report.status_changed",
  "analysis.requested",
  "analysis.completed",
  "findings.opened",
  "access.requested",
  "access.approved",
  "access.granted",
  "evidence.fetched",
  "message.sent",
  "anchor.published",
] as const;

export type LogEntryType = (typeof logEntryTypes)[number];
export type LogFieldValue = string | number;
export type LogEntry = {
  index: number;
  entry_type: string;
  entry: Record<string, LogFieldValue>;
  leaf_b64u: string;
  created_at: string;
};
export type LogKey = { key_id: string; public_key: string };
export type InclusionProof = {
  index: number;
  tree_size: number;
  leaf_hash: string;
  audit_path: string[];
};
export type ConsistencyProof = { first: number; second: number; proof: string[] };
export type Anchor = {
  tree_size: number;
  root_hash: string;
  chain: string;
  tx_ref: string;
  created_at: string;
};
export type LogReviewer = { reviewer_id: string; display_name: string; role?: string };

export type AuditClient = {
  mode: "showcase" | "live";
  source: string;
  getKey(): Promise<LogKey>;
  getLatestTreeHead(): Promise<SignedTreeHead>;
  getKnownTreeHeads(): Promise<SignedTreeHead[]>;
  getEntries(start: number, end: number): Promise<LogEntry[]>;
  getInclusionProof(index: number, treeSize: number): Promise<InclusionProof>;
  getConsistencyProof(first: number, second: number): Promise<ConsistencyProof>;
  getAnchors(): Promise<Anchor[]>;
  getReviewers(): Promise<LogReviewer[]>;
  getFocusReportId(): Promise<string | null>;
};

export class AuditClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuditClientError";
  }
}

const pageSize = 1000;

async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, { cache: "no-store" });
  } catch {
    throw new AuditClientError("network", "The log server could not be reached.");
  }
  if (!response.ok) {
    let message = `The log server answered ${response.status}.`;
    let code = "http_error";
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.message) message = body.error.message;
      if (body.error?.code) code = body.error.code;
    } catch {
      code = "http_error";
    }
    throw new AuditClientError(code, message);
  }
  return (await response.json()) as T;
}

function createLiveClient(): AuditClient {
  return {
    mode: "live",
    source: apiUrl,
    getKey: () => getJson<LogKey>("/v1/log/key"),
    getLatestTreeHead: () => getJson<SignedTreeHead>("/v1/log/sth"),
    async getKnownTreeHeads() {
      return [await getJson<SignedTreeHead>("/v1/log/sth")];
    },
    async getEntries(start, end) {
      const result: LogEntry[] = [];
      for (let from = start; from < end; from += pageSize) {
        const to = Math.min(end, from + pageSize);
        result.push(...(await getJson<LogEntry[]>(`/v1/log/entries?start=${from}&end=${to}`)));
      }
      return result;
    },
    getInclusionProof: (index, treeSize) =>
      getJson<InclusionProof>(`/v1/log/proofs/inclusion?index=${index}&tree_size=${treeSize}`),
    getConsistencyProof: (first, second) =>
      getJson<ConsistencyProof>(`/v1/log/proofs/consistency?first=${first}&second=${second}`),
    getAnchors: () => getJson<Anchor[]>("/v1/log/anchors"),
    async getReviewers() {
      try {
        const campaign = await getJson<{ reviewers?: LogReviewer[] }>(
          `/v1/campaigns/${encodeURIComponent(defaultCampaign)}`,
        );
        return campaign.reviewers ?? [];
      } catch {
        return [];
      }
    },
    getFocusReportId: async () => null,
  };
}

export type ShowcaseLog = {
  log: LogKey;
  showcase_report_id: string;
  reviewers: (LogReviewer & { enc_pk: string; enc_key_id: string })[];
  entries: LogEntry[];
  tree_heads: SignedTreeHead[];
  inclusion: InclusionProof[];
  consistency: ConsistencyProof[];
  anchors: Anchor[];
};

let showcaseData: Promise<ShowcaseLog> | null = null;

export function loadShowcaseLog(): Promise<ShowcaseLog> {
  showcaseData ??= import("@/data/showcase-log.json").then(
    (module) => module.default as unknown as ShowcaseLog,
  );
  return showcaseData;
}

function createShowcaseClient(): AuditClient {
  const latestOf = (data: ShowcaseLog) => data.tree_heads[data.tree_heads.length - 1]!;
  return {
    mode: "showcase",
    source: "Recorded showcase log",
    getKey: async () => (await loadShowcaseLog()).log,
    getLatestTreeHead: async () => latestOf(await loadShowcaseLog()),
    getKnownTreeHeads: async () => (await loadShowcaseLog()).tree_heads,
    getEntries: async (start, end) =>
      (await loadShowcaseLog()).entries.filter(
        (entry) => entry.index >= start && entry.index < end,
      ),
    async getInclusionProof(index, treeSize) {
      const data = await loadShowcaseLog();
      const proof = data.inclusion.find(
        (item) => item.index === index && item.tree_size === treeSize,
      );
      if (!proof)
        throw new AuditClientError(
          "proof_unavailable",
          `No recorded inclusion proof for entry ${index} in a tree of ${treeSize}.`,
        );
      return proof;
    },
    async getConsistencyProof(first, second) {
      if (first === second) return { first, second, proof: [] };
      const data = await loadShowcaseLog();
      const proof = data.consistency.find((item) => item.first === first && item.second === second);
      if (!proof)
        throw new AuditClientError(
          "proof_unavailable",
          `No recorded consistency proof from ${first} to ${second}.`,
        );
      return proof;
    },
    getAnchors: async () => (await loadShowcaseLog()).anchors,
    getReviewers: async () => (await loadShowcaseLog()).reviewers,
    getFocusReportId: async () => (await loadShowcaseLog()).showcase_report_id,
  };
}

export function createAuditClient(): AuditClient {
  return showcaseMode ? createShowcaseClient() : createLiveClient();
}

const rememberedKey = "candor-log-checkpoint";

export function rememberTreeHead(sth: SignedTreeHead) {
  try {
    localStorage.setItem(rememberedKey, JSON.stringify(sth));
  } catch {
    return;
  }
}

export function recallTreeHead(): SignedTreeHead | null {
  try {
    const raw = localStorage.getItem(rememberedKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SignedTreeHead>;
    if (
      typeof value.tree_size !== "number" ||
      typeof value.root_hash !== "string" ||
      typeof value.timestamp !== "string" ||
      typeof value.key_id !== "string" ||
      typeof value.signature !== "string"
    )
      return null;
    return value as SignedTreeHead;
  } catch {
    return null;
  }
}

type CryptoModule = typeof Crypto;
let cryptoModule: Promise<CryptoModule> | null = null;

export function loadCrypto(): Promise<CryptoModule> {
  cryptoModule ??= import("@candor/crypto").then(async (module) => {
    await module.ready();
    return module;
  });
  return cryptoModule;
}

export type PathStep = {
  side: "left" | "right";
  sibling: { start: number; end: number };
  node: { start: number; end: number };
};

function largestPowerBelow(size: number) {
  return 2 ** Math.floor(Math.log2(size - 1));
}

export function auditPathShape(index: number, treeSize: number): PathStep[] {
  const walk = (start: number, size: number): PathStep[] => {
    if (size <= 1) return [];
    const k = largestPowerBelow(size);
    const node = { start, end: start + size };
    if (index < start + k)
      return [
        ...walk(start, k),
        { side: "right", sibling: { start: start + k, end: node.end }, node },
      ];
    return [
      ...walk(start + k, size - k),
      { side: "left", sibling: { start, end: start + k }, node },
    ];
  };
  return walk(0, treeSize);
}

export function consistencyShape(first: number, second: number) {
  const walk = (
    m: number,
    start: number,
    size: number,
    complete: boolean,
  ): { start: number; end: number }[] => {
    if (m === size) return complete ? [] : [{ start, end: start + size }];
    const k = largestPowerBelow(size);
    if (m <= k) return [...walk(m, start, k, complete), { start: start + k, end: start + size }];
    return [...walk(m - k, start + k, size - k, false), { start, end: start + k }];
  };
  if (first === 0 || first === second) return [];
  return walk(first, 0, second, true);
}

export type TreeNode = { start: number; end: number; depth: number };

export function treeLayout(treeSize: number): { nodes: TreeNode[]; depth: number } {
  const nodes: TreeNode[] = [];
  let maxDepth = 0;
  const walk = (start: number, size: number, depth: number) => {
    nodes.push({ start, end: start + size, depth });
    maxDepth = Math.max(maxDepth, depth);
    if (size <= 1) return;
    const k = largestPowerBelow(size);
    walk(start, k, depth + 1);
    walk(start + k, size - k, depth + 1);
  };
  if (treeSize > 0) walk(0, treeSize, 0);
  return { nodes, depth: maxDepth };
}

export function hourBucket(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString().replace(".000Z", "Z");
}
