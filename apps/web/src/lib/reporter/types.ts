import type { Campaign } from "@candor/sdk";

export type CampaignInfo = {
  campaignId: string;
  orgName: string;
  title: string;
  description: string;
  threshold: number;
  reviewers: { reviewerId: string; displayName: string; encPk: string; keyId: string }[];
  enclave: { keyId: string; encPk: string };
  issuer: { keyId: string; spki: string };
  mode: "showcase" | "live";
  descriptor: Campaign;
};

export type SelfSession = {
  sessionId: string;
  scope: string;
  endpoint: string;
  userId: string;
  mode: "mock" | "staging" | "mainnet";
};

export type VerificationResult =
  { status: "verified"; allowance: number } | { status: "rejected"; reason: string };

export type SealStep = {
  id: string;
  label: string;
  detail: string;
  values?: { label: string; value: string }[];
  durationMs: number;
};

export type Receipt = {
  reportId: string;
  codename: string;
  evidenceRoot: string;
  logIndex: number;
  treeSize: number;
  rootHash: string;
  submittedAt: string;
  bytesSent: number;
};
