export type SelfMode = "mock" | "staging" | "mainnet";

export interface Campaign {
  id: string;
  scope: string;
  issuer_private_jwk_encrypted: string;
  issuer_spki: string;
  key_id: string;
  tokens_per_epoch: number;
  epoch_days: number;
  created_at: number;
}

export type RejectionReason =
  "quota_exhausted" | "proof_invalid" | "age_requirement" | "epoch_expired";

export interface Session {
  id: string;
  campaign_id: string;
  status: "pending" | "verified" | "rejected" | "consumed";
  allowance: number;
  reason: RejectionReason | null;
  created_at: number;
  expires_at: number;
  tag: string | null;
  epoch: number | null;
}

export interface NullifierTag {
  tag: string;
  campaign_id: string;
  epoch: number;
  issued: number;
}

export class ServiceError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409 | 410 | 413 | 429 | 503,
    readonly code: string,
  ) {
    super(code);
  }
}
