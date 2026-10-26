import { randomBytes } from "node:crypto";

import { RSABSSA } from "@cloudflare/blindrsa-ts";
import type { Hono } from "hono";
import { expect } from "vitest";

import type { LogEntry } from "../src/app.js";
import { createApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { decode, encode } from "../src/crypto.js";
import type { SelfInput, SelfVerifier } from "../src/self.js";
import type { Store } from "../src/store.js";
import { MemoryStore } from "../src/store.js";

export interface Issuer {
  campaign_id: string;
  key_id: string;
  spki: string;
  alg: string;
}

export interface IssueResult {
  blind_signatures: string[];
  key_id: string;
  epoch_ends_at: string;
}

export const clientSuite = RSABSSA.SHA384.PSS.Randomized();

export function setup(
  store: Store = new MemoryStore(),
  overrides: Partial<Config> = {},
  verifier?: SelfVerifier,
) {
  const config: Config = {
    port: 8787,
    dataDir: "unused",
    secret: randomBytes(32).toString("hex"),
    adminToken: randomBytes(32).toString("hex"),
    selfMode: "mock",
    selfEndpoint: "https://identity.example/v1/self/verify",
    webUrl: "https://candor.example",
    ...overrides,
  };
  const logs: LogEntry[] = [];
  let time = Date.UTC(2026, 9, 26, 12);
  const app = createApp({
    config,
    store,
    verifier,
    now: () => time,
    logger: (entry) => logs.push(entry),
  });
  return {
    app,
    config,
    store,
    logs,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
    now: () => time,
  };
}

export function post(app: Hono, path: string, body: unknown, token?: string): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

export async function createCampaign(
  app: Hono,
  token: string,
  campaign = "northwind-ethics",
  settings = {},
): Promise<Issuer> {
  const response = await post(
    app,
    "/v1/admin/campaigns",
    { campaign_id: campaign, ...settings },
    token,
  );
  expect(response.status).toBe(200);
  return response.json() as Promise<Issuer>;
}

export async function createSession(app: Hono, campaign = "northwind-ethics"): Promise<string> {
  const response = await post(app, "/v1/sessions", { campaign_id: campaign });
  expect(response.status).toBe(200);
  const session = (await response.json()) as { session_id: string };
  return session.session_id;
}

export async function verifySession(
  app: Hono,
  id: string,
  persona = "demo-persona",
): Promise<Response> {
  return post(app, `/v1/sessions/${id}/mock-verify`, { persona });
}

export async function clientMessages(issuer: Issuer, count = 3) {
  const key = await crypto.subtle.importKey(
    "spki",
    decode(issuer.spki),
    { name: "RSA-PSS", hash: "SHA-384" },
    true,
    ["verify"],
  );
  const messages = [];
  for (let index = 0; index < count; index++) {
    const prepared = clientSuite.prepare(crypto.getRandomValues(new Uint8Array(32)));
    const blind = await clientSuite.blind(key, prepared);
    messages.push({ prepared, ...blind });
  }
  return {
    key,
    messages,
    body: { blinded_messages: messages.map((message) => encode(message.blindedMsg)) },
  };
}

export function proofInput(id: string): SelfInput {
  return {
    attestationId: 1,
    proof: {
      a: ["1", "2"],
      b: [
        ["3", "4"],
        ["5", "6"],
      ],
      c: ["7", "8"],
    },
    publicSignals: Array.from({ length: 21 }, () => "1"),
    userContextData: `${"0".repeat(64)}${id.replaceAll("-", "").padStart(64, "0")}`,
  };
}
