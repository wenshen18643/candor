import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decode, encode, nullifierTag, sha256 } from "../src/crypto.js";
import { mockNullifier } from "../src/self.js";
import { epochAt, SESSION_TTL } from "../src/service.js";
import type { Issuer, IssueResult } from "./helpers.js";
import {
  clientMessages,
  clientSuite,
  createCampaign,
  createSession,
  post,
  setup,
  verifySession,
} from "./helpers.js";

describe("identity HTTP service", () => {
  let context: ReturnType<typeof setup>;
  let issuer: Issuer;

  beforeEach(async () => {
    context = setup();
    issuer = await createCampaign(context.app, context.config.adminToken);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    context.store.close();
  });

  it("completes RFC 9474 blind issuance with three independently finalized signatures", async () => {
    const { app, store, config } = context;
    const id = await createSession(app);
    expect(await (await verifySession(app, id)).json()).toEqual({
      status: "verified",
      allowance: 3,
      reason: null,
    });
    const campaign = store.campaign("northwind-ethics")!;
    const raw = mockNullifier("demo-persona", campaign.scope);
    const tag = store.session(id)!.tag;
    expect(tag).not.toBe(raw);
    expect(tag).toBe(
      nullifierTag(config.secret, campaign.id, epochAt(campaign, context.now()), raw),
    );
    const client = await clientMessages(issuer);
    const response = await post(app, `/v1/sessions/${id}/issue`, client.body);
    expect(response.status).toBe(200);
    const issued = (await response.json()) as IssueResult;
    expect(issued.key_id).toBe(issuer.key_id);
    expect(issued.blind_signatures).toHaveLength(3);
    expect(new Date(issued.epoch_ends_at).getTime()).toBeGreaterThan(context.now());
    for (const [index, message] of client.messages.entries()) {
      const signature = await clientSuite.finalize(
        client.key,
        message.prepared,
        decode(issued.blind_signatures[index]!),
        message.inv,
      );
      expect(await clientSuite.verify(client.key, signature, message.prepared)).toBe(true);
      expect(
        await crypto.subtle.verify(
          { name: "RSA-PSS", saltLength: 48 },
          client.key,
          new Uint8Array(signature),
          new Uint8Array(message.prepared),
        ),
      ).toBe(true);
      expect(
        await clientSuite.verify(client.key, signature, crypto.getRandomValues(new Uint8Array(64))),
      ).toBe(false);
    }
    expect(await (await app.request(`/v1/sessions/${id}`)).json()).toEqual({
      status: "consumed",
      allowance: 0,
      reason: null,
    });
    expect(store.session(id)!.tag).toBeNull();
    expect(store.tag(tag!)!.issued).toBe(3);
    expect((await post(app, `/v1/sessions/${id}/issue`, client.body)).status).toBe(409);
    expect((await verifySession(app, id)).status).toBe(409);
  });

  it("exhausts the fourth token without linking the same persona across campaigns", async () => {
    const { app } = context;
    const id = await createSession(app);
    await verifySession(app, id);
    const client = await clientMessages(issuer);
    expect((await post(app, `/v1/sessions/${id}/issue`, client.body)).status).toBe(200);
    const again = await createSession(app);
    expect(await (await verifySession(app, again)).json()).toEqual({
      status: "rejected",
      allowance: 0,
      reason: "quota_exhausted",
    });
    const otherIssuer = await createCampaign(app, context.config.adminToken, "other-ethics");
    const other = await createSession(app, "other-ethics");
    expect(await (await verifySession(app, other)).json()).toMatchObject({
      status: "verified",
      allowance: 3,
    });
    expect(otherIssuer.key_id).not.toBe(issuer.key_id);
    const otherClient = await clientMessages(otherIssuer, 1);
    const issued = (await (
      await post(app, `/v1/sessions/${other}/issue`, otherClient.body)
    ).json()) as IssueResult;
    const message = otherClient.messages[0]!;
    const signature = await clientSuite.finalize(
      otherClient.key,
      message.prepared,
      decode(issued.blind_signatures[0]!),
      message.inv,
    );
    expect(await clientSuite.verify(client.key, signature, message.prepared)).toBe(false);
  });

  it("charges only issued tokens and offers the remainder to a new session", async () => {
    const id = await createSession(context.app);
    await verifySession(context.app, id);
    const client = await clientMessages(issuer, 1);
    expect((await post(context.app, `/v1/sessions/${id}/issue`, client.body)).status).toBe(200);
    const next = await createSession(context.app);
    expect(await (await verifySession(context.app, next)).json()).toMatchObject({ allowance: 2 });
    const tooMany = await clientMessages(issuer, 3);
    expect((await post(context.app, `/v1/sessions/${next}/issue`, tooMany.body)).status).toBe(400);
    expect(context.store.session(next)!.status).toBe("verified");
  });

  it("does not overspend quota when verified sessions race", async () => {
    const ids = await Promise.all([createSession(context.app), createSession(context.app)]);
    await Promise.all(ids.map((id) => verifySession(context.app, id)));
    const client = await clientMessages(issuer);
    const responses = await Promise.all(
      ids.map((id) => post(context.app, `/v1/sessions/${id}/issue`, client.body)),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 429]);
    expect(ids.map((id) => context.store.session(id)!.status).sort()).toEqual([
      "consumed",
      "verified",
    ]);
  });

  it("consumes a session once when issuance races with itself", async () => {
    const id = await createSession(context.app);
    await verifySession(context.app, id);
    const client = await clientMessages(issuer, 1);
    const responses = await Promise.all([
      post(context.app, `/v1/sessions/${id}/issue`, client.body),
      post(context.app, `/v1/sessions/${id}/issue`, client.body),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  });

  it("expires verification and issuance exactly at the TTL and purges sessions", async () => {
    const pending = await createSession(context.app);
    const verified = await createSession(context.app);
    await verifySession(context.app, verified);
    const client = await clientMessages(issuer, 1);
    context.advance(SESSION_TTL);
    expect((await context.app.request(`/v1/sessions/${verified}`)).status).toBe(410);
    expect((await verifySession(context.app, pending)).status).toBe(410);
    expect((await post(context.app, `/v1/sessions/${verified}/issue`, client.body)).status).toBe(
      410,
    );
    expect(context.store.purge(context.now())).toBe(2);
    expect((await context.app.request(`/v1/sessions/${verified}`)).status).toBe(404);
  });

  it("rechecks expiry after asynchronous signing preparation", async () => {
    const id = await createSession(context.app);
    await verifySession(context.app, id);
    const client = await clientMessages(issuer, 1);
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (...args) => {
      const result = await decrypt(...args);
      context.advance(SESSION_TTL);
      return result;
    });
    const response = await post(context.app, `/v1/sessions/${id}/issue`, client.body);
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "session_expired" });
    const session = context.store.session(id)!;
    expect(session.status).toBe("verified");
    expect(context.store.tag(session.tag!)).toBeUndefined();
  });

  it("resets quota at an epoch boundary and forbids carrying verification across it", async () => {
    const campaign = context.store.campaign(issuer.campaign_id)!;
    const nextEpoch = (epochAt(campaign, context.now()) + 1) * campaign.epoch_days * 86400000;
    context.advance(nextEpoch - context.now() - 1000);
    const stale = await createSession(context.app);
    const spent = await createSession(context.app);
    await verifySession(context.app, stale);
    await verifySession(context.app, spent);
    const oldTag = context.store.session(stale)!.tag;
    const client = await clientMessages(issuer);
    expect((await post(context.app, `/v1/sessions/${spent}/issue`, client.body)).status).toBe(200);
    context.advance(1000);
    const response = await post(context.app, `/v1/sessions/${stale}/issue`, client.body);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "epoch_expired" });
    const fresh = await createSession(context.app);
    expect(await (await verifySession(context.app, fresh)).json()).toMatchObject({
      status: "verified",
      allowance: 3,
    });
    expect(context.store.session(fresh)!.tag).not.toBe(oldTag);
  });

  it("rejects malformed, out-of-range and duplicate messages without spending allowance", async () => {
    const id = await createSession(context.app);
    await verifySession(context.app, id);
    const client = await clientMessages(issuer, 1);
    const invalid = [
      [],
      ["AA=="],
      ["AA"],
      [encode(new Uint8Array(256))],
      [encode(new Uint8Array(256).fill(255))],
      Array(4).fill(client.body.blinded_messages[0]),
      [client.body.blinded_messages[0], client.body.blinded_messages[0]],
    ];
    for (const messages of invalid) {
      expect(
        (await post(context.app, `/v1/sessions/${id}/issue`, { blinded_messages: messages }))
          .status,
      ).toBe(400);
      expect(context.store.session(id)!.status).toBe("verified");
    }
    expect((await post(context.app, `/v1/sessions/${id}/issue`, client.body)).status).toBe(200);
  });

  it("keeps campaign creation idempotent under concurrent calls and protects admin access", async () => {
    expect(
      (await post(context.app, "/v1/admin/campaigns", { campaign_id: "unauthorized" })).status,
    ).toBe(401);
    expect(
      (await post(context.app, "/v1/admin/campaigns", { campaign_id: "unauthorized" }, "incorrect"))
        .status,
    ).toBe(401);
    const responses = await Promise.all([
      createCampaign(context.app, context.config.adminToken, "fresh"),
      createCampaign(context.app, context.config.adminToken, "fresh"),
    ]);
    expect(responses[0]).toEqual(responses[1]);
    const unchanged = await createCampaign(
      context.app,
      context.config.adminToken,
      "northwind-ethics",
      { tokens_per_epoch: 9 },
    );
    expect(unchanged.key_id).toBe(issuer.key_id);
    expect(context.store.campaign(issuer.campaign_id)!.tokens_per_epoch).toBe(3);
    expect(issuer.key_id).toBe(sha256(decode(issuer.spki)).slice(0, 16));
    const fetched = await context.app.request(`/v1/campaigns/${issuer.campaign_id}/issuer`);
    expect(await fetched.json()).toEqual({
      campaign_id: issuer.campaign_id,
      alg: "RSABSSA-SHA384-PSS-Randomized",
      key_id: issuer.key_id,
      spki: issuer.spki,
    });
  });

  it("rejects campaign scope truncation collisions", async () => {
    const prefix = "a".repeat(30);
    await createCampaign(context.app, context.config.adminToken, `${prefix}-one`);
    const response = await post(
      context.app,
      "/v1/admin/campaigns",
      { campaign_id: `${prefix}-two` },
      context.config.adminToken,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "campaign_scope_conflict" });
  });

  it("honors configured quotas while limiting each verification to three tokens", async () => {
    await createCampaign(context.app, context.config.adminToken, "small", {
      tokens_per_epoch: 1,
      epoch_days: 1,
    });
    const small = await createSession(context.app, "small");
    expect(await (await verifySession(context.app, small)).json()).toMatchObject({ allowance: 1 });
    await createCampaign(context.app, context.config.adminToken, "large", { tokens_per_epoch: 9 });
    const large = await createSession(context.app, "large");
    expect(await (await verifySession(context.app, large)).json()).toMatchObject({ allowance: 3 });
  });

  it("serves the QR contract, CORS, no-store and health", async () => {
    const response = await post(context.app, "/v1/sessions", { campaign_id: issuer.campaign_id });
    const result = (await response.json()) as {
      session_id: string;
      expires_at: string;
      self: unknown;
    };
    expect(new Date(result.expires_at).getTime() - context.now()).toBe(SESSION_TTL);
    expect(result.self).toEqual({
      mode: "mock",
      scope: "candor-northwind-ethics",
      endpoint: context.config.selfEndpoint,
      app_name: "Candor",
      user_id: result.session_id,
      user_id_type: "uuid",
      disclosures: { minimumAge: 18, ofac: false },
    });
    const health = await context.app.request("/health", {
      headers: { Origin: context.config.webUrl },
    });
    expect(await health.json()).toEqual({ status: "ok" });
    expect(health.headers.get("Access-Control-Allow-Origin")).toBe(context.config.webUrl);
    expect(health.headers.get("Cache-Control")).toBe("no-store");
    const foreign = await context.app.request("/health", {
      headers: { Origin: "https://evil.example" },
    });
    expect(foreign.headers.get("Access-Control-Allow-Origin")).not.toBe("https://evil.example");
    const preflight = await context.app.request("/v1/sessions", {
      method: "OPTIONS",
      headers: { Origin: context.config.webUrl, "Access-Control-Request-Method": "POST" },
    });
    expect(preflight.status).toBe(204);
  });

  it("validates boundaries and keeps payloads and session identifiers out of logs", async () => {
    const id = await createSession(context.app);
    await verifySession(context.app, id, "sensitive-persona");
    expect((await post(context.app, "/v1/sessions", { campaign_id: "unknown" })).status).toBe(404);
    expect((await post(context.app, "/v1/sessions", { campaign_id: "UPPER" })).status).toBe(400);
    expect((await context.app.request(`/v1/sessions/${randomUUID()}`)).status).toBe(404);
    expect((await context.app.request("/v1/sessions/bad-id")).status).toBe(400);
    expect((await context.app.request("/missing-sensitive-path?value=hidden")).status).toBe(404);
    expect(
      (
        await context.app.request("/v1/sessions", {
          method: "POST",
          body: "bad-json",
          headers: { "Content-Type": "application/json" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await post(context.app, "/v1/sessions", { campaign_id: "x".repeat(40000) })).status,
    ).toBe(413);
    const logs = JSON.stringify(context.logs);
    for (const value of [
      id,
      "sensitive-persona",
      "missing-sensitive-path",
      "hidden",
      context.config.adminToken,
      context.config.secret,
    ])
      expect(logs.includes(value)).toBe(false);
    expect(
      context.logs.every((entry) => entry.event === "request" && typeof entry.status === "number"),
    ).toBe(true);
  });
});
