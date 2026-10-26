import { constants, generateKeyPairSync, privateEncrypt } from "node:crypto";

import {
  authMessage,
  b64u,
  inboxAuthMessage,
  sha256,
  toHex,
  verifyBlindToken,
  verifyDetached,
} from "@candor/crypto";
import { describe, expect, it, vi } from "vitest";

import type { WalletTypedData } from "../src/index.js";
import { CandorClient, CandorError, createPayment } from "../src/index.js";
import { fixture, quote } from "./fixtures.js";

function mockedClient(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    handler(new URL(String(url)), init ?? {}),
  );
  return {
    fetch,
    client: new CandorClient({
      apiUrl: "https://api.test",
      identityUrl: "https://identity.test",
      fetch,
    }),
  };
}

describe("identity and authentication", () => {
  it("prepares, issues and finalizes real blinded RSA tokens through injectable fetch", async () => {
    const { input } = await fixture();
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const spki = new Uint8Array(pair.publicKey.export({ format: "der", type: "spki" }));
    const issuer = { spki: b64u.encode(spki), key_id: toHex(sha256(spki)).slice(0, 16) };
    const { client } = mockedClient((url, init) => {
      expect(url.origin).toBe("https://identity.test");
      expect(new Headers(init.headers).has("Authorization")).toBe(false);
      const body = JSON.parse(String(init.body)) as { blinded_messages: string[] };
      expect(body.blinded_messages).toHaveLength(3);
      return Response.json({
        key_id: issuer.key_id,
        epoch_ends_at: "2026-11-01T00:00:00Z",
        blind_signatures: body.blinded_messages.map((message) =>
          b64u.encode(
            privateEncrypt(
              { key: pair.privateKey, padding: constants.RSA_NO_PADDING },
              b64u.decode(message),
            ),
          ),
        ),
      });
    });
    const tokens = await client.mintTokens({ ...input.campaign, issuer }, "session", 3);
    expect(tokens).toHaveLength(3);
    for (const token of tokens) expect(await verifyBlindToken(issuer.spki, token)).toBe(true);
  });

  it("signs challenges and separates reviewer, inbox and public credentials", async () => {
    const { signing } = await fixture();
    const { client, fetch } = mockedClient((url, init) => {
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
      if (url.pathname.endsWith("challenge"))
        return Response.json({ challenge: "challenge", expires_at: "future" });
      if (url.pathname === "/v1/auth/token") {
        expect(
          verifyDetached(
            b64u.decode(body.signature!),
            authMessage(body.reviewer_id!, body.challenge!),
            signing[0]!.publicKey,
          ),
        ).toBe(true);
        return Response.json({ token: "reviewer-token", expires_at: "future" });
      }
      if (url.pathname === "/v1/inbox/session") {
        expect(
          verifyDetached(
            b64u.decode(body.signature!),
            inboxAuthMessage(body.sig_pk!, body.challenge!),
            b64u.decode(body.sig_pk!),
          ),
        ).toBe(true);
        return Response.json({ token: "inbox-token", report_ids: ["r"], expires_at: "future" });
      }
      return Response.json([]);
    });
    await client.signIn("r", signing[0]!.privateKey);
    const inbox = await client.signInInbox(
      "abacus-abdomen-abdominal-abide-abiding-ability-ablaze-able",
    );
    expect(inbox.session.report_ids).toEqual(["r"]);
    await client.listReports();
    expect(new Headers(fetch.mock.lastCall![1]?.headers).get("Authorization")).toBe(
      "Bearer reviewer-token",
    );
    await client.getInboxMessages();
    expect(new Headers(fetch.mock.lastCall![1]?.headers).get("Authorization")).toBe(
      "Bearer inbox-token",
    );
    await client.loadCampaign("test");
    expect(new Headers(fetch.mock.lastCall![1]?.headers).has("Authorization")).toBe(false);
    client.signOut();
    await client.listReports();
    expect(new Headers(fetch.mock.lastCall![1]?.headers).has("Authorization")).toBe(false);
  });

  it("polls terminal verification and supports cancellation", async () => {
    let count = 0;
    const { client } = mockedClient(() =>
      Response.json({ status: ++count < 2 ? "pending" : "verified", allowance: 3, reason: null }),
    );
    expect((await client.waitForVerification("s", { intervalMs: 0 })).status).toBe("verified");
    const pending = mockedClient(() => Response.json({ status: "pending" })).client;
    await expect(
      pending.waitForVerification("s", { timeoutMs: 10, intervalMs: 20 }),
    ).rejects.toThrow();
  });
});

describe("HTTP endpoints", () => {
  it("uses the contract methods, paths and request bodies", async () => {
    const { input } = await fixture();
    const { client, fetch } = mockedClient(() => Response.json({}));
    client.setToken("reviewer");
    client.setInboxToken("inbox");
    const cases: [() => Promise<unknown>, string, string, unknown?][] = [
      [() => client.loadCampaign("a/b"), "GET", "/v1/campaigns/a%2Fb"],
      [() => client.startVerification("test"), "POST", "/v1/sessions", { campaign_id: "test" }],
      [
        () => client.mockVerify("s", "synthetic"),
        "POST",
        "/v1/sessions/s/mock-verify",
        { persona: "synthetic" },
      ],
      [() => client.pollVerification("s"), "GET", "/v1/sessions/s"],
      [
        () => client.issueBlindTokens("s", ["blinded"]),
        "POST",
        "/v1/sessions/s/issue",
        { blinded_messages: ["blinded"] },
      ],
      [() => client.listIdentities(), "GET", "/v1/demo/identities"],
      [() => client.listReports("triage"), "GET", "/v1/reports?status=triage"],
      [() => client.getReport("r"), "GET", "/v1/reports/r"],
      [() => client.getFile("r", 0), "GET", "/v1/reports/r/files/0"],
      [() => client.setStatus("r", "closed"), "PATCH", "/v1/reports/r", { status: "closed" }],
      [() => client.getJob("j"), "GET", "/v1/jobs/j"],
      [
        () => client.requestAccess("r", "review"),
        "POST",
        "/v1/reports/r/access-requests",
        { reason: "review" },
      ],
      [() => client.listAccessRequests(), "GET", "/v1/access-requests?status=pending"],
      [() => client.getAccessRequest("a"), "GET", "/v1/access-requests/a"],
      [
        () => client.approveAccess("a", { signature: "sig", resealed_share: "share" }),
        "POST",
        "/v1/access-requests/a/approve",
        { signature: "sig", resealed_share: "share" },
      ],
      [() => client.getInboxMessages(), "GET", "/v1/inbox/messages"],
      [() => client.getLogKey(), "GET", "/v1/log/key"],
      [() => client.getTreeHead(), "GET", "/v1/log/sth"],
      [() => client.getLogEntries(1, 2), "GET", "/v1/log/entries?start=1&end=2"],
      [() => client.getInclusionProof(1, 3), "GET", "/v1/log/proofs/inclusion?index=1&tree_size=3"],
      [
        () => client.getConsistencyProof(1, 3),
        "GET",
        "/v1/log/proofs/consistency?first=1&second=3",
      ],
      [() => client.getAnchors(), "GET", "/v1/log/anchors"],
      [() => client.sendChaff({ padding: "a" }), "POST", "/v1/chaff", { padding: "a" }],
    ];
    for (const [call, method, path, body] of cases) {
      await call();
      const [url, init] = fetch.mock.lastCall!;
      expect(new URL(String(url)).pathname + new URL(String(url)).search).toBe(path);
      expect(init?.method).toBe(method);
      expect(init?.body).toBe(body === undefined ? undefined : JSON.stringify(body));
      expect(init?.redirect).toBe("error");
    }
    const message = {
      kind: "question" as const,
      body: "Synthetic",
      questions: [{ question_id: "q", text: "When?" }],
      sent_at: "2026-10-26T00:00:00Z",
    };
    await client.sendQuestions("r", input.campaign.reviewers[0]!.enc_pk, message);
    expect(String(fetch.mock.lastCall![1]?.body)).not.toContain("Synthetic");
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body)).question_ids).toEqual(["q"]);
    await client.reply("r", input.campaign.reviewers, {
      kind: "reply",
      body: "Synthetic",
      answers: message.questions,
      sent_at: message.sent_at,
    });
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body)).boxes).toHaveLength(3);
  });

  it("returns safe typed errors without reflecting bodies", async () => {
    const { client } = mockedClient(() =>
      Response.json(
        { error: { code: "token_spent", message: "private evidence" } },
        { status: 409 },
      ),
    );
    await expect(client.listReports()).rejects.toMatchObject({ status: 409, code: "token_spent" });
    await expect(client.listReports()).rejects.not.toThrow("private evidence");
    const invalid = mockedClient(() => new Response("not JSON", { status: 502 })).client;
    await expect(invalid.listReports()).rejects.toBeInstanceOf(CandorError);
    const malformed = mockedClient(() => new Response("not JSON")).client;
    await expect(malformed.listReports()).rejects.toMatchObject({ code: "invalid_response" });
    const empty = mockedClient(() => new Response(null, { status: 204 })).client;
    await expect(empty.sendChaff({})).resolves.toBeUndefined();
    expect(
      () =>
        new CandorClient({
          apiUrl: "https://user:password@api.test",
          identityUrl: "https://identity.test",
        }),
    ).toThrow();
  });
});

describe("x402", () => {
  it("produces deterministic mock payments and passes idempotency headers", async () => {
    const options = { mode: "mock" as const, nonce: `0x${"0".repeat(64)}` };
    expect(await createPayment(quote, options)).toBe(await createPayment(quote, options));
    const { client, fetch } = mockedClient((_url, init) =>
      new Headers(init.headers).has("X-PAYMENT")
        ? Response.json({ job_id: "j", status: "queued" })
        : Response.json({ x402Version: 1, accepts: [quote] }, { status: 402 }),
    );
    expect(await client.quoteAnalysis("r")).toEqual(quote);
    expect(
      (await client.payAndRunAnalysis("r", quote, { ...options, idempotencyKey: "stable" })).job_id,
    ).toBe("j");
    const headers = new Headers(fetch.mock.lastCall![1]?.headers);
    expect(headers.get("Idempotency-Key")).toBe("stable");
    expect(JSON.parse(atob(headers.get("X-PAYMENT")!)).payload.mock).toBe(true);
  });

  it("asks the wallet to sign exact EIP-3009 typed data", async () => {
    let typed: WalletTypedData | undefined;
    const payment = await createPayment(quote, {
      mode: "testnet",
      now: 1800000000000,
      nonce: `0x${"1".repeat(64)}`,
      wallet: {
        address: `0x${"c".repeat(40)}`,
        signTypedData: async (data) => {
          typed = data;
          return `0x${"d".repeat(130)}`;
        },
      },
    });
    expect(typed?.domain).toEqual({
      name: "USDC",
      version: "2",
      chainId: 84532,
      verifyingContract: quote.asset,
    });
    expect(typed?.message).toMatchObject({
      value: "500000",
      to: quote.payTo,
      validAfter: "1799999940",
      validBefore: "1800000300",
    });
    expect(JSON.parse(atob(payment)).payload.authorization).toEqual(typed?.message);
    await expect(createPayment(quote, { mode: "testnet" })).rejects.toThrow();
    await expect(createPayment({ ...quote, maxAmountRequired: "-1" })).rejects.toThrow();
    await expect(createPayment(quote, { nonce: "invalid" })).rejects.toThrow();
  });
});
