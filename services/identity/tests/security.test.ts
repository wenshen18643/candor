import { randomBytes } from "node:crypto";

import { afterEach, expect, it, vi } from "vitest";

import { jsonLogger } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { sessionFromContext } from "../src/self.js";
import { createCampaign, createSession, post, proofInput, setup } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

it("omits precise request timing and correlation identifiers from identity logs", async () => {
  const context = setup();
  await context.app.request("/health");
  expect(Object.keys(context.logs[0]!).sort()).toEqual(["event", "method", "route", "status"]);
  const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  jsonLogger({ event: "request", method: "POST", route: "/v1/sessions", status: 200 });
  const output = JSON.parse(String(write.mock.calls[0]![0])) as { timestamp: string };
  expect(output.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/);
  context.store.close();
});

it.each(["staging", "mock"])("rejects %s identity verification in production", (selfMode) => {
  expect(() =>
    readConfig({
      CANDOR_MODE: "production",
      SELF_MODE: selfMode,
      SELF_ENDPOINT: "https://identity.example/v1/self/verify",
      CANDOR_IDENTITY_SECRET: randomBytes(32).toString("hex"),
      CANDOR_IDENTITY_ADMIN_TOKEN: randomBytes(32).toString("hex"),
    }),
  ).toThrow("invalid_configuration");
});

it("rejects invalid deployment modes instead of silently enabling demo admission", () => {
  expect(() =>
    readConfig({
      CANDOR_MODE: "prod",
      CANDOR_IDENTITY_SECRET: randomBytes(32).toString("hex"),
      CANDOR_IDENTITY_ADMIN_TOKEN: randomBytes(32).toString("hex"),
    }),
  ).toThrow("invalid_configuration:CANDOR_MODE");
});

it("rate limits session creation without trusting forwarded addresses", async () => {
  const context = setup();
  await createCampaign(context.app, context.config.adminToken);
  let rejected = false;
  for (let index = 0; index < 150; index++) {
    const response = await context.app.request("/v1/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": `192.0.2.${index}` },
      body: JSON.stringify({ campaign_id: "northwind-ethics" }),
    });
    if (response.status === 429) {
      expect(response.headers.get("Retry-After")).toBeTruthy();
      rejected = true;
      break;
    }
  }
  expect(rejected).toBe(true);
  context.advance(60_000);
  expect(
    (await post(context.app, "/v1/sessions", { campaign_id: "northwind-ethics" })).status,
  ).toBe(200);
  context.store.close();
});

it("rate limits proof callbacks with the relayer error contract", async () => {
  const context = setup(undefined, { selfMode: "staging" });
  let rejected = false;
  for (let index = 0; index < 150; index++) {
    const response = await post(context.app, "/v1/self/verify", {});
    const body = (await response.json()) as { reason: string };
    if (body.reason === "rate_limited") {
      expect(response.status).toBe(200);
      rejected = true;
      break;
    }
  }
  expect(rejected).toBe(true);
  context.store.close();
});

it("caps concurrent proof checks and releases capacity after completion", async () => {
  let finish: () => void = () => {};
  let started: () => void = () => {};
  let active = 0;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const context = setup(
    undefined,
    { selfMode: "staging" },
    {
      verify: async (input) => {
        if (++active === 16) started();
        await gate;
        return { valid: true, ageValid: true, userId: sessionFromContext(input), nullifier: "1" };
      },
    },
  );
  await createCampaign(context.app, context.config.adminToken);
  const id = await createSession(context.app);
  const requests = Array.from({ length: 16 }, () =>
    post(context.app, "/v1/self/verify", proofInput(id)),
  );
  try {
    await ready;
    expect(await (await post(context.app, "/v1/self/verify", proofInput(id))).json()).toMatchObject(
      { reason: "rate_limited" },
    );
  } finally {
    finish();
    await Promise.all(requests);
  }
  expect(await (await post(context.app, "/v1/self/verify", proofInput(id))).json()).toEqual({
    status: "success",
    result: true,
  });
  context.store.close();
});
