import { randomUUID } from "node:crypto";

import type { VerificationResult } from "@selfxyz/core";
import { ConfigMismatch, ConfigMismatchError, SelfBackendVerifier } from "@selfxyz/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceError } from "../src/models.js";
import type { SelfInput, SelfResult, SelfVerifier } from "../src/self.js";
import { OfficialSelfVerifier, parseSelfInput, sessionFromContext } from "../src/self.js";
import { SESSION_TTL } from "../src/service.js";
import type { Issuer } from "./helpers.js";
import {
  clientMessages,
  createCampaign,
  createSession,
  post,
  proofInput,
  setup,
} from "./helpers.js";

class ControlledVerifier implements SelfVerifier {
  result: Partial<SelfResult> = {};
  scopes: string[] = [];
  onVerify: (() => void) | undefined;
  failure: Error | undefined;

  async verify(input: SelfInput, scope: string): Promise<SelfResult> {
    this.scopes.push(scope);
    this.onVerify?.();
    if (this.failure) throw this.failure;
    return {
      valid: true,
      ageValid: true,
      userId: sessionFromContext(input),
      nullifier: "12345678901234567890",
      ...this.result,
    };
  }
}

describe("Self callback", () => {
  let context: ReturnType<typeof setup>;
  let verifier: ControlledVerifier;
  let issuer: Issuer;

  beforeEach(async () => {
    verifier = new ControlledVerifier();
    context = setup(undefined, { selfMode: "staging" }, verifier);
    issuer = await createCampaign(context.app, context.config.adminToken);
  });

  afterEach(() => context.store.close());

  it("binds verified context to the session, issues tokens and enforces quota", async () => {
    const id = await createSession(context.app);
    const response = await post(context.app, "/v1/self/verify", proofInput(id));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "success", result: true });
    expect(verifier.scopes).toEqual(["candor-northwind-ethics"]);
    expect(context.store.session(id)!.allowance).toBe(3);
    const client = await clientMessages(issuer);
    expect((await post(context.app, `/v1/sessions/${id}/issue`, client.body)).status).toBe(200);
    const next = await createSession(context.app);
    expect(await (await post(context.app, "/v1/self/verify", proofInput(next))).json()).toEqual({
      status: "error",
      result: false,
      reason: "quota_exhausted",
    });
    expect(context.store.session(next)!.status).toBe("rejected");
  });

  it.each([
    [{ valid: false }, "proof_invalid"],
    [{ ageValid: false }, "age_requirement"],
    [{ userId: randomUUID() }, "proof_invalid"],
    [{ nullifier: "" }, "proof_invalid"],
  ] as const)("rejects failed verification policy %#", async (result, reason) => {
    verifier.result = result;
    const id = await createSession(context.app);
    const response = await post(context.app, "/v1/self/verify", proofInput(id));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "error", result: false, reason });
    expect(context.store.session(id)).toMatchObject({
      status: "rejected",
      allowance: 0,
      tag: null,
      reason,
    });
  });

  it("does not resurrect expired sessions after an asynchronous proof check", async () => {
    const id = await createSession(context.app);
    verifier.onVerify = () => {
      context.advance(SESSION_TTL);
      context.store.purge(context.now());
    };
    const response = await post(context.app, "/v1/self/verify", proofInput(id));
    expect(await response.json()).toMatchObject({
      status: "error",
      result: false,
      reason: "session_not_found",
    });
    expect(context.store.session(id)).toBeUndefined();
  });

  it("never reopens a consumed session on a replayed proof", async () => {
    const id = await createSession(context.app);
    await post(context.app, "/v1/self/verify", proofInput(id));
    const client = await clientMessages(issuer, 1);
    await post(context.app, `/v1/sessions/${id}/issue`, client.body);
    const replay = await post(context.app, "/v1/self/verify", proofInput(id));
    expect(await replay.json()).toEqual({ status: "success", result: true });
    expect(context.store.session(id)!.status).toBe("consumed");
    expect(verifier.scopes).toHaveLength(1);
  });

  it("leaves sessions retryable on verifier outages without exposing exceptions", async () => {
    const id = await createSession(context.app);
    verifier.failure = new ServiceError(503, "self_verifier_unavailable");
    expect(await (await post(context.app, "/v1/self/verify", proofInput(id))).json()).toEqual({
      status: "error",
      result: false,
      reason: "self_verifier_unavailable",
    });
    expect(context.store.session(id)!.status).toBe("pending");
    verifier.failure = new Error("sensitive-provider-response");
    expect(await (await post(context.app, "/v1/self/verify", proofInput(id))).json()).toEqual({
      status: "error",
      result: false,
      reason: "internal_error",
    });
    expect(JSON.stringify(context.logs).includes("sensitive-provider-response")).toBe(false);
  });

  it("rejects invalid callback bodies and disables mock admission in real modes", async () => {
    const id = await createSession(context.app);
    expect(
      (await post(context.app, `/v1/sessions/${id}/mock-verify`, { persona: "anything" })).status,
    ).toBe(404);
    const valid = proofInput(id);
    for (const bad of [
      {},
      { ...valid, attestationId: 99 },
      { ...valid, publicSignals: [] },
      { ...valid, proof: { a: [], b: [], c: [] } },
      { ...valid, userContextData: "not-hex" },
    ]) {
      const response = await post(context.app, "/v1/self/verify", bad);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "error", result: false });
    }
    expect(verifier.scopes).toHaveLength(0);
    expect(context.store.session(id)!.status).toBe("pending");
  });
});

function sdkResult(id: string): VerificationResult {
  return {
    attestationId: 1,
    isValidDetails: { isValid: true, isMinimumAgeValid: true, isOfacValid: false },
    forbiddenCountriesList: [],
    userData: { userIdentifier: id, userDefinedData: "sensitive-context" },
    discloseOutput: {
      nullifier: "12345",
      forbiddenCountriesListPacked: [],
      issuingState: "",
      name: "sensitive-name",
      idNumber: "sensitive-document",
      nationality: "",
      dateOfBirth: "sensitive-birthdate",
      gender: "",
      expiryDate: "",
      minimumAge: "18",
      ofac: [false, false, false],
    },
  };
}

describe("official Self SDK adapter", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["staging", "mainnet"] as const)(
    "runs the real %s constructor with the SDK proof call mocked",
    async (mode) => {
      const context = setup(undefined, { selfMode: mode });
      try {
        await createCampaign(context.app, context.config.adminToken);
        const id = await createSession(context.app);
        const proof = proofInput(id);
        const verify = vi
          .spyOn(SelfBackendVerifier.prototype, "verify")
          .mockResolvedValue(sdkResult(id));
        const response = await post(context.app, "/v1/self/verify", proof);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: "success", result: true });
        expect(verify).toHaveBeenCalledWith(
          1,
          proof.proof,
          proof.publicSignals,
          proof.userContextData,
        );
        expect(JSON.stringify(context.store.session(id)).includes("sensitive")).toBe(false);
        expect(JSON.stringify(context.logs).includes("12345")).toBe(false);
      } finally {
        context.store.close();
      }
    },
  );

  it("requires age validity even when cryptographic proof validity is true", async () => {
    const id = randomUUID();
    const result = sdkResult(id);
    result.isValidDetails.isMinimumAgeValid = false;
    vi.spyOn(SelfBackendVerifier.prototype, "verify").mockResolvedValue(result);
    expect(
      await new OfficialSelfVerifier("staging", "https://identity.example").verify(
        proofInput(id),
        "candor-test",
      ),
    ).toMatchObject({ valid: true, ageValid: false });
  });

  it("rejects the undisclosed zero-age sentinel even if an SDK flag reports true", async () => {
    const id = randomUUID();
    const result = sdkResult(id);
    result.discloseOutput.minimumAge = "00";
    vi.spyOn(SelfBackendVerifier.prototype, "verify").mockResolvedValue(result);
    expect(
      await new OfficialSelfVerifier("staging", "https://identity.example").verify(
        proofInput(id),
        "candor-test",
      ),
    ).toMatchObject({ ageValid: false });
  });

  it("sanitizes SDK mismatches and RPC failures", async () => {
    const id = randomUUID();
    const verify = vi
      .spyOn(SelfBackendVerifier.prototype, "verify")
      .mockRejectedValue(
        new ConfigMismatchError([
          { type: ConfigMismatch.InvalidMinimumAge, message: "sensitive-error" },
        ]),
      );
    const adapter = new OfficialSelfVerifier("mainnet", "https://identity.example");
    expect(await adapter.verify(proofInput(id), "candor-test")).toEqual({
      valid: false,
      ageValid: false,
      userId: id,
      nullifier: "",
    });
    verify.mockRejectedValue(new Error("sensitive-rpc-error"));
    await expect(adapter.verify(proofInput(id), "candor-test")).rejects.toMatchObject({
      code: "self_verifier_unavailable",
    });
  });

  it("normalizes the documented hex context and rejects identifiers outside UUID width", () => {
    const id = randomUUID();
    const input = proofInput(id);
    expect(
      sessionFromContext(
        parseSelfInput({ ...input, userContextData: `0x${input.userContextData.toUpperCase()}` }),
      ),
    ).toBe(id);
    expect(() =>
      sessionFromContext({
        ...input,
        userContextData: `${"0".repeat(64)}1${input.userContextData.slice(65)}`,
      }),
    ).toThrow();
  });

  it("disables arbitrary proof callbacks in mock mode", async () => {
    const context = setup();
    try {
      const response = await post(context.app, "/v1/self/verify", proofInput(randomUUID()));
      expect(await response.json()).toEqual({
        status: "error",
        result: false,
        reason: "self_callback_disabled",
      });
    } finally {
      context.store.close();
    }
  });
});
