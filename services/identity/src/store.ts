import { DatabaseSync } from "node:sqlite";

import type { Campaign, NullifierTag, Session } from "./models.js";

export interface Store {
  campaign(id: string): Campaign | undefined;
  campaignByScope(scope: string): Campaign | undefined;
  putCampaign(campaign: Campaign): void;
  session(id: string): Session | undefined;
  putSession(session: Session): void;
  tag(tag: string): NullifierTag | undefined;
  putTag(tag: NullifierTag): void;
  transaction<T>(operation: () => T): T;
  purge(now: number): number;
  close(): void;
}

export class MemoryStore implements Store {
  private campaigns = new Map<string, Campaign>();
  private sessions = new Map<string, Session>();
  private tags = new Map<string, NullifierTag>();

  campaign(id: string): Campaign | undefined {
    return structuredClone(this.campaigns.get(id));
  }

  campaignByScope(scope: string): Campaign | undefined {
    return structuredClone([...this.campaigns.values()].find((value) => value.scope === scope));
  }

  putCampaign(campaign: Campaign): void {
    this.campaigns.set(campaign.id, structuredClone(campaign));
  }

  session(id: string): Session | undefined {
    return structuredClone(this.sessions.get(id));
  }

  putSession(session: Session): void {
    this.sessions.set(session.id, structuredClone(session));
  }

  tag(tag: string): NullifierTag | undefined {
    return structuredClone(this.tags.get(tag));
  }

  putTag(tag: NullifierTag): void {
    this.tags.set(tag.tag, structuredClone(tag));
  }

  transaction<T>(operation: () => T): T {
    const snapshot = structuredClone([this.campaigns, this.sessions, this.tags] as const);
    try {
      return operation();
    } catch (error) {
      [this.campaigns, this.sessions, this.tags] = snapshot;
      throw error;
    }
  }

  purge(now: number): number {
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (session.expires_at <= now) {
        this.sessions.delete(id);
        removed++;
      }
    }
    return removed;
  }

  close(): void {
    this.campaigns.clear();
    this.sessions.clear();
    this.tags.clear();
  }
}

export class SqliteStore implements Store {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL UNIQUE,
        issuer_private_jwk_encrypted TEXT NOT NULL, issuer_spki TEXT NOT NULL,
        key_id TEXT NOT NULL, tokens_per_epoch INTEGER NOT NULL CHECK(tokens_per_epoch > 0),
        epoch_days INTEGER NOT NULL CHECK(epoch_days > 0), created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id),
        status TEXT NOT NULL CHECK(status IN ('pending', 'verified', 'rejected', 'consumed')),
        allowance INTEGER NOT NULL CHECK(allowance >= 0), reason TEXT,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, tag TEXT, epoch INTEGER
      ) STRICT;
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS nullifier_tags (
        tag TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id),
        epoch INTEGER NOT NULL, issued INTEGER NOT NULL CHECK(issued >= 0)
      ) STRICT;
    `);
  }

  campaign(id: string): Campaign | undefined {
    return this.database.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as unknown as
      Campaign | undefined;
  }

  campaignByScope(scope: string): Campaign | undefined {
    return this.database
      .prepare("SELECT * FROM campaigns WHERE scope = ?")
      .get(scope) as unknown as Campaign | undefined;
  }

  putCampaign(value: Campaign): void {
    this.database
      .prepare(`INSERT INTO campaigns VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        value.id,
        value.scope,
        value.issuer_private_jwk_encrypted,
        value.issuer_spki,
        value.key_id,
        value.tokens_per_epoch,
        value.epoch_days,
        value.created_at,
      );
  }

  session(id: string): Session | undefined {
    return this.database.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as unknown as
      Session | undefined;
  }

  putSession(value: Session): void {
    this.database
      .prepare(
        `
      INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, allowance=excluded.allowance,
        reason=excluded.reason, tag=excluded.tag, epoch=excluded.epoch
    `,
      )
      .run(
        value.id,
        value.campaign_id,
        value.status,
        value.allowance,
        value.reason,
        value.created_at,
        value.expires_at,
        value.tag,
        value.epoch,
      );
  }

  tag(tag: string): NullifierTag | undefined {
    return this.database
      .prepare("SELECT * FROM nullifier_tags WHERE tag = ?")
      .get(tag) as unknown as NullifierTag | undefined;
  }

  putTag(value: NullifierTag): void {
    this.database
      .prepare(
        `
      INSERT INTO nullifier_tags VALUES (?, ?, ?, ?)
      ON CONFLICT(tag) DO UPDATE SET issued=excluded.issued
    `,
      )
      .run(value.tag, value.campaign_id, value.epoch, value.issued);
  }

  transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  purge(now: number): number {
    return Number(
      this.database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now).changes,
    );
  }

  close(): void {
    this.database.close();
  }
}
