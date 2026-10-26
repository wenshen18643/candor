import type { AttestationId, SelfBackendVerifier } from "@selfxyz/core";

import { sha256 } from "./crypto.js";
import type { SelfMode } from "./models.js";
import { ServiceError } from "./models.js";
import { record, text, uuid } from "./validation.js";

export interface SelfInput {
  attestationId: AttestationId;
  proof: Parameters<SelfBackendVerifier["verify"]>[1];
  publicSignals: string[];
  userContextData: string;
}

export interface SelfResult {
  valid: boolean;
  ageValid: boolean;
  userId: string;
  nullifier: string;
}

export interface SelfVerifier {
  verify(input: SelfInput, scope: string): Promise<SelfResult>;
}

function field(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  const result = text(value, 80);
  if (!/^(?:[0-9]+|0x[0-9a-fA-F]+)$/.test(result)) throw new ServiceError(400, "invalid_proof");
  return BigInt(result).toString();
}

function pair(value: unknown): [string, string] {
  if (!Array.isArray(value) || value.length !== 2) throw new ServiceError(400, "invalid_proof");
  return [field(value[0]), field(value[1])];
}

export function parseSelfInput(body: Record<string, unknown>): SelfInput {
  const attestationId = Number(body.attestationId);
  if (attestationId !== 1 && attestationId !== 2)
    throw new ServiceError(400, "unsupported_attestation");
  const proof = record(body.proof);
  const b = proof.b;
  if (!Array.isArray(b) || b.length !== 2) throw new ServiceError(400, "invalid_proof");
  if (!Array.isArray(body.publicSignals) || body.publicSignals.length !== 21) {
    throw new ServiceError(400, "invalid_proof");
  }
  const userContextData = text(body.userContextData, 4096).replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{128,}$/.test(userContextData) || userContextData.length % 2 !== 0) {
    throw new ServiceError(400, "invalid_user_context");
  }
  return {
    attestationId,
    proof: { a: pair(proof.a), b: [pair(b[0]), pair(b[1])], c: pair(proof.c) },
    publicSignals: body.publicSignals.map(field),
    userContextData,
  };
}

export function sessionFromContext(input: SelfInput): string {
  const identifier = input.userContextData.slice(64, 128);
  if (!/^0{32}/.test(identifier)) throw new ServiceError(400, "invalid_user_context");
  const hex = identifier.slice(32);
  return uuid(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  );
}

export function mockNullifier(persona: string, scope: string): string {
  return sha256(`candor/mock-self/${persona}/${scope}`);
}

export class MockSelfVerifier implements SelfVerifier {
  async verify(_input: SelfInput, _scope: string): Promise<SelfResult> {
    throw new ServiceError(404, "self_callback_disabled");
  }
}

export class OfficialSelfVerifier implements SelfVerifier {
  constructor(
    private readonly mode: Exclude<SelfMode, "mock">,
    private readonly endpoint: string,
  ) {}

  async verify(input: SelfInput, scope: string): Promise<SelfResult> {
    const sdk = await import("@selfxyz/core");
    class DisposableVerifier extends sdk.SelfBackendVerifier {
      dispose(): void {
        this.provider.destroy();
      }
    }
    const verifier = new DisposableVerifier(
      scope,
      this.endpoint,
      this.mode === "staging",
      new Map([
        [1, true],
        [2, true],
      ]),
      new sdk.DefaultConfigStore({ minimumAge: 18, ofac: false }),
      "uuid",
    );
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        verifier.verify(
          input.attestationId,
          input.proof,
          input.publicSignals,
          input.userContextData,
        ),
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(
            () => reject(new ServiceError(503, "self_verifier_unavailable")),
            20_000,
          );
        }),
      ]);
      return {
        valid: result.isValidDetails.isValid,
        ageValid:
          result.isValidDetails.isMinimumAgeValid && Number(result.discloseOutput.minimumAge) >= 18,
        userId: result.userData.userIdentifier,
        nullifier: BigInt(result.discloseOutput.nullifier).toString(),
      };
    } catch (error) {
      if (error instanceof sdk.ConfigMismatchError) {
        return {
          valid: false,
          ageValid: !error.issues.some(
            (issue) => issue.type === sdk.ConfigMismatch.InvalidMinimumAge,
          ),
          userId: sessionFromContext(input),
          nullifier: "",
        };
      }
      throw new ServiceError(503, "self_verifier_unavailable");
    } finally {
      clearTimeout(deadline);
      verifier.dispose();
    }
  }
}
