import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  decryptIssuer,
  encode,
  encryptIssuer,
  nullifierTag,
  signMessages,
  suite,
} from "../src/crypto.js";
import type { Campaign, Session } from "../src/models.js";
import type { Store } from "../src/store.js";
import { MemoryStore, SqliteStore } from "../src/store.js";
import type { IssueResult } from "./helpers.js";
import {
  clientMessages,
  clientSuite,
  createCampaign,
  createSession,
  post,
  setup,
  verifySession,
} from "./helpers.js";

const temporaryRoot = resolve("node_modules", ".identity-test-data");
const directories: string[] = [];
const stores: Store[] = [];

function databasePath(): string {
  mkdirSync(temporaryRoot, { recursive: true });
  const directory = mkdtempSync(join(temporaryRoot, "store-"));
  directories.push(directory);
  return join(directory, "identity.db");
}

function open(path: string): SqliteStore {
  const store = new SqliteStore(path);
  stores.push(store);
  return store;
}

function close(store: Store): void {
  store.close();
  stores.splice(stores.indexOf(store), 1);
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(`${temporaryRoot}${sep}`))
      throw new Error("invalid_test_directory");
    rmSync(directory, { recursive: true, force: true });
  }
});

describe.each(["memory", "sqlite"])("%s Store contract", (kind) => {
  function fixture(): { store: Store; campaign: Campaign; session: Session } {
    const store = kind === "sqlite" ? open(databasePath()) : new MemoryStore();
    if (kind === "memory") stores.push(store);
    const campaign: Campaign = {
      id: "test",
      scope: "candor-test",
      issuer_private_jwk_encrypted: "encrypted",
      issuer_spki: "public",
      key_id: "id",
      tokens_per_epoch: 3,
      epoch_days: 30,
      created_at: 100,
    };
    const session: Session = {
      id: randomUUID(),
      campaign_id: "test",
      status: "pending",
      allowance: 0,
      reason: null,
      created_at: 100,
      expires_at: 200,
      tag: null,
      epoch: null,
    };
    store.putCampaign(campaign);
    store.putSession(session);
    return { store, campaign, session };
  }

  it("round-trips records and purges only expired sessions", () => {
    const { store, campaign, session } = fixture();
    expect(store.campaign(campaign.id)).toEqual(campaign);
    expect(store.campaignByScope(campaign.scope)).toEqual(campaign);
    expect(store.session(session.id)).toEqual(session);
    store.putSession({ ...session, id: randomUUID(), expires_at: 201 });
    store.putTag({ tag: "scoped-tag", campaign_id: campaign.id, epoch: 1, issued: 2 });
    expect(store.purge(200)).toBe(1);
    expect(store.session(session.id)).toBeUndefined();
    expect(store.tag("scoped-tag")!.issued).toBe(2);
    expect(store.campaign(campaign.id)).toBeDefined();
    expect(store.purge(201)).toBe(1);
  });

  it("rolls back quota and session changes together", () => {
    const { store, session } = fixture();
    expect(() =>
      store.transaction(() => {
        store.putTag({ tag: "scoped-tag", campaign_id: "test", epoch: 1, issued: 3 });
        store.putSession({ ...session, status: "consumed" });
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    expect(store.session(session.id)!.status).toBe("pending");
    expect(store.tag("scoped-tag")).toBeUndefined();
    expect(store.transaction(() => 42)).toBe(42);
  });

  it("does not leak mutable references to stored records", () => {
    const { store, campaign, session } = fixture();
    campaign.tokens_per_epoch = 100;
    session.allowance = 100;
    const fetched = store.session(session.id)!;
    fetched.allowance = 200;
    expect(store.campaign("test")!.tokens_per_epoch).toBe(3);
    expect(store.session(session.id)!.allowance).toBe(0);
  });
});

describe("encrypted persistent issuance", () => {
  it("matches the blindrsa-ts signer exactly using native private RSA", async () => {
    const keys = await suite.generateKey({
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    });
    const prepared = suite.prepare(crypto.getRandomValues(new Uint8Array(32)));
    const { blindedMsg } = await suite.blind(keys.publicKey, prepared);
    expect(await signMessages(keys.privateKey, [encode(blindedMsg)])).toEqual([
      encode(await suite.blindSign(keys.privateKey, blindedMsg)),
    ]);
  });

  it("survives a restart with the same key, verified session and spent quota", async () => {
    const path = databasePath();
    const first = setup(open(path));
    const issuer = await createCampaign(first.app, first.config.adminToken);
    const id = await createSession(first.app);
    await verifySession(first.app, id);
    const stored = first.store.campaign(issuer.campaign_id)!;
    expect(stored.issuer_private_jwk_encrypted.startsWith("v1.")).toBe(true);
    expect(stored.issuer_private_jwk_encrypted.includes('"d"')).toBe(false);
    close(first.store);
    const next = setup(open(path), first.config);
    expect(next.store.campaign(issuer.campaign_id)!.key_id).toBe(issuer.key_id);
    const client = await clientMessages(issuer);
    const response = await post(next.app, `/v1/sessions/${id}/issue`, client.body);
    expect(response.status).toBe(200);
    const issued = (await response.json()) as IssueResult;
    for (const [index, message] of client.messages.entries()) {
      const signature = await clientSuite.finalize(
        client.key,
        message.prepared,
        new Uint8Array(Buffer.from(issued.blind_signatures[index]!, "base64url")),
        message.inv,
      );
      expect(await clientSuite.verify(client.key, signature, message.prepared)).toBe(true);
    }
    close(next.store);
    const final = setup(open(path), first.config);
    const again = await createSession(final.app);
    expect(await (await verifySession(final.app, again)).json()).toMatchObject({
      status: "rejected",
      reason: "quota_exhausted",
    });
    close(final.store);
    const disk = readFileSync(path).toString("utf8");
    for (const marker of [
      '"d":',
      '"p":',
      "demo-persona",
      first.config.secret,
      ...client.body.blinded_messages,
    ])
      expect(disk.includes(marker)).toBe(false);
  });

  it("coordinates quota across two independent SQLite connections", async () => {
    const path = databasePath();
    const first = setup(open(path));
    const issuer = await createCampaign(first.app, first.config.adminToken);
    const second = setup(open(path), first.config);
    const one = await createSession(first.app);
    const two = await createSession(second.app);
    await verifySession(first.app, one);
    await verifySession(second.app, two);
    const client = await clientMessages(issuer);
    const results = await Promise.all([
      post(first.app, `/v1/sessions/${one}/issue`, client.body),
      post(second.app, `/v1/sessions/${two}/issue`, client.body),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 429]);
  });

  it("authenticates encrypted issuer envelopes against tampering, wrong secrets and campaign swaps", async () => {
    const secret = randomBytes(32).toString("hex");
    const keys = await suite.generateKey({
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    });
    const envelope = await encryptIssuer(keys.privateKey, secret, "campaign-a");
    const restored = await decryptIssuer(envelope, secret, "campaign-a");
    expect(await crypto.subtle.exportKey("jwk", restored)).toEqual(
      await crypto.subtle.exportKey("jwk", keys.privateKey),
    );
    await expect(
      decryptIssuer(envelope, randomBytes(32).toString("hex"), "campaign-a"),
    ).rejects.toThrow();
    await expect(decryptIssuer(envelope, secret, "campaign-b")).rejects.toThrow();
    const parts = envelope.split(".");
    const ciphertext = Buffer.from(parts[3]!, "base64url");
    ciphertext[0] = ciphertext[0]! ^ 1;
    parts[3] = encode(ciphertext);
    await expect(decryptIssuer(parts.join("."), secret, "campaign-a")).rejects.toThrow();
    await expect(decryptIssuer("v0.invalid", secret, "campaign-a")).rejects.toThrow();
  });

  it("separates nullifier tags by campaign, epoch and service secret", () => {
    const secret = randomBytes(32).toString("hex");
    const raw = randomBytes(32).toString("hex");
    const tags = [
      nullifierTag(secret, "a", 1, raw),
      nullifierTag(secret, "b", 1, raw),
      nullifierTag(secret, "a", 2, raw),
      nullifierTag(`${secret}2`, "a", 1, raw),
    ];
    expect(new Set(tags).size).toBe(4);
    expect(tags.every((tag) => tag !== raw && /^[a-f0-9]{64}$/.test(tag))).toBe(true);
  });
});
