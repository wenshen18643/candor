import { randomUUID } from "node:crypto";

import {
  decryptIssuer,
  encode,
  encryptIssuer,
  nullifierTag,
  sha256,
  signMessages,
  suite,
} from "./crypto.js";
import type { Campaign, RejectionReason, Session } from "./models.js";
import { ServiceError } from "./models.js";
import type { SelfInput, SelfResult, SelfVerifier } from "./self.js";
import { mockNullifier, sessionFromContext } from "./self.js";
import type { Store } from "./store.js";

export const SESSION_TTL = 15 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export function epochAt(campaign: Campaign, now: number): number {
  return Math.floor(now / (campaign.epoch_days * DAY));
}

export function issuer(campaign: Campaign) {
  return {
    campaign_id: campaign.id,
    alg: suite.toString(),
    key_id: campaign.key_id,
    spki: campaign.issuer_spki,
  };
}

export function sessionStatus(session: Session) {
  return { status: session.status, allowance: session.allowance, reason: session.reason };
}

export class IdentityService {
  constructor(
    private readonly store: Store,
    private readonly secret: string,
    private readonly verifier: SelfVerifier,
    private readonly now: () => number = Date.now,
  ) {}

  campaign(id: string): Campaign {
    const campaign = this.store.campaign(id);
    if (!campaign) throw new ServiceError(404, "campaign_not_found");
    return campaign;
  }

  async createCampaign(id: string, tokens: number, days: number): Promise<Campaign> {
    const existing = this.store.campaign(id);
    if (existing) return existing;
    const scope = `candor-${id}`.slice(0, 31);
    if (this.store.campaignByScope(scope)) throw new ServiceError(409, "campaign_scope_conflict");
    const keys = await suite.generateKey({
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    });
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
    const campaign: Campaign = {
      id,
      scope,
      issuer_private_jwk_encrypted: await encryptIssuer(keys.privateKey, this.secret, id),
      issuer_spki: encode(spki),
      key_id: sha256(spki).slice(0, 16),
      tokens_per_epoch: tokens,
      epoch_days: days,
      created_at: this.now(),
    };
    return this.store.transaction(() => {
      const concurrent = this.store.campaign(id);
      if (concurrent) return concurrent;
      if (this.store.campaignByScope(scope)) throw new ServiceError(409, "campaign_scope_conflict");
      this.store.putCampaign(campaign);
      return campaign;
    });
  }

  createSession(campaignId: string): Session {
    this.campaign(campaignId);
    const now = this.now();
    const session: Session = {
      id: randomUUID(),
      campaign_id: campaignId,
      status: "pending",
      allowance: 0,
      reason: null,
      created_at: now,
      expires_at: now + SESSION_TTL,
      tag: null,
      epoch: null,
    };
    this.store.putSession(session);
    return session;
  }

  session(id: string): Session {
    const session = this.store.session(id);
    if (!session) throw new ServiceError(404, "session_not_found");
    if (session.expires_at <= this.now()) throw new ServiceError(410, "session_expired");
    return session;
  }

  private pending(id: string): Session {
    const session = this.session(id);
    if (session.status !== "pending") throw new ServiceError(409, "session_not_pending");
    return session;
  }

  private reject(session: Session, reason: RejectionReason): Session {
    const rejected: Session = {
      ...session,
      status: "rejected",
      reason,
      allowance: 0,
      tag: null,
      epoch: null,
    };
    this.store.putSession(rejected);
    return rejected;
  }

  private applyVerification(id: string, result: SelfResult): Session {
    return this.store.transaction(() => {
      const session = this.session(id);
      if (session.status !== "pending") return session;
      if (result.userId !== id) return this.reject(session, "proof_invalid");
      if (!result.ageValid) return this.reject(session, "age_requirement");
      if (!result.valid || !result.nullifier || result.nullifier.length > 128)
        return this.reject(session, "proof_invalid");
      const campaign = this.campaign(session.campaign_id);
      const epoch = epochAt(campaign, this.now());
      const tag = nullifierTag(this.secret, campaign.id, epoch, result.nullifier);
      const remaining = campaign.tokens_per_epoch - (this.store.tag(tag)?.issued ?? 0);
      if (remaining <= 0) return this.reject(session, "quota_exhausted");
      const verified: Session = {
        ...session,
        status: "verified",
        allowance: Math.min(3, remaining),
        tag,
        epoch,
      };
      this.store.putSession(verified);
      return verified;
    });
  }

  mockVerify(id: string, persona: string): Session {
    const session = this.pending(id);
    const campaign = this.campaign(session.campaign_id);
    return this.applyVerification(id, {
      valid: true,
      ageValid: true,
      userId: id,
      nullifier: mockNullifier(persona, campaign.scope),
    });
  }

  async verify(input: SelfInput): Promise<Session> {
    const id = sessionFromContext(input);
    const session = this.session(id);
    if (session.status !== "pending") return session;
    const campaign = this.campaign(session.campaign_id);
    const result = await this.verifier.verify(input, campaign.scope);
    return this.applyVerification(id, result);
  }

  private issuable(id: string, count: number): { session: Session; campaign: Campaign } {
    const session = this.session(id);
    if (session.status !== "verified" || !session.tag || session.epoch === null) {
      throw new ServiceError(409, "session_not_verified");
    }
    if (count < 1 || count > session.allowance)
      throw new ServiceError(400, "invalid_message_count");
    const campaign = this.campaign(session.campaign_id);
    if (session.epoch !== epochAt(campaign, this.now()))
      throw new ServiceError(409, "epoch_expired");
    if ((this.store.tag(session.tag)?.issued ?? 0) + count > campaign.tokens_per_epoch) {
      throw new ServiceError(429, "quota_exhausted");
    }
    return { session, campaign };
  }

  async issue(id: string, messages: string[]) {
    const { campaign } = this.issuable(id, messages.length);
    const key = await decryptIssuer(
      campaign.issuer_private_jwk_encrypted,
      this.secret,
      campaign.id,
    );
    const signatures = await signMessages(key, messages);
    const epoch = this.store.transaction(() => {
      const { session } = this.issuable(id, messages.length);
      const tag = session.tag!;
      const epoch = session.epoch!;
      this.store.putTag({
        tag,
        campaign_id: campaign.id,
        epoch,
        issued: (this.store.tag(tag)?.issued ?? 0) + messages.length,
      });
      this.store.putSession({
        ...session,
        status: "consumed",
        allowance: 0,
        tag: null,
        epoch: null,
      });
      return epoch;
    });
    return {
      blind_signatures: signatures,
      key_id: campaign.key_id,
      epoch_ends_at: new Date((epoch + 1) * campaign.epoch_days * DAY).toISOString(),
    };
  }
}
