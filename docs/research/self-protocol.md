# Self off-chain identity verification — verified 2026-10-26

## Current product status and package versions

**The requested self-hosted QR + `SelfBackendVerifier` integration still exists, but Self now labels it “Self Pass (Legacy)”.** Official guidance directs new integrations to managed **Self Enterprise**, which hosts verification and delivers signed webhooks. Enterprise is not a drop-in verifier class; Self Connect is a different identifier-to-address protocol. The self-hosted path below matches Candor's requested architecture. [Current documentation](https://docs.self.xyz/docs/self-pass/), [migration guide](https://docs.self.xyz/docs/self-enterprise/migration/from-self-pass-sdk/).

| npm package | Registry result | What was verified |
|---|---|---|
| `@selfxyz/qrcode` | **1.0.25** latest | Installed; ESM import and `SelfAppBuilder(...).build()` ran |
| `@selfxyz/sdk-common` | **1.0.1** latest | Installed QR dependency; builder source/types inspected |
| `@selfxyz/core` | **1.2.0-beta.1** `latest`; **1.2.0-beta.3** `beta` | Both published tarballs and declarations inspected; full installs blocked as below |
| `@selfxyz/common` | **0.0.10** latest | Tarballs inspected; beta.1 requires `^0.0.9`, beta.3 requires `^0.0.10` |
| `@selfxyz/enterprise-sdk` | **0.4.1** latest | Registry and official SDK docs verified; not runtime-tested |

The highest published core version is beta.3, but unqualified `npm install @selfxyz/core` resolves the `latest` tag beta.1. Explicitly pin the intended release. QR and core declare **Node `>=22 <23`**; QR peers support React **18 or 19**. Local QR smoke test ran on Node **24.15.0** with an engine warning; use Node 22 for the supported deployment target. Both QR and core publish ESM/CJS entry points.

```powershell
# Existing/self-hosted integration: default-tag versions researched here
npm install @selfxyz/qrcode@1.0.25 @selfxyz/core@1.2.0-beta.1
# Explicit newer beta alternative (constructor difference documented below):
npm install @selfxyz/core@1.2.0-beta.3
# Managed successor, instead of self-hosted verification:
npm install @selfxyz/enterprise-sdk@0.4.1
```

**Install limitation actually observed:** both core installs failed with npm 12.2.0 `EALLOWGIT`: transitive `@selfxyz/common` depends on `node-forge@github:remicolin/forge#17a11a632dd0e50343b3b8393245a2696f78afbb`, and this machine disables Git package fetches. `--ignore-scripts` does not bypass this. No dependency overrides or security-setting changes were made. Therefore backend constructor/import execution and a real passport proof were **not** tested. Published `.d.ts`/JS are the source of the backend API below.

Registry sources: [QR](https://registry.npmjs.org/@selfxyz%2fqrcode), [core](https://registry.npmjs.org/@selfxyz%2fcore), [sdk-common](https://registry.npmjs.org/@selfxyz%2fsdk-common), [common](https://registry.npmjs.org/@selfxyz%2fcommon), [Enterprise SDK](https://registry.npmjs.org/@selfxyz%2fenterprise-sdk). Source: [Self repository](https://github.com/selfxyz/self).

## Frontend QR request

```tsx
"use client";
import { useMemo } from "react";
import { SelfAppBuilder, SelfQRcodeWrapper } from "@selfxyz/qrcode";

// userId should be an opaque UUID issued/bound to a pending server session.
export function VerificationQR({ userId }: { userId: string }) {
  const selfApp = useMemo(() => new SelfAppBuilder({
    appName: "Candor",
    scope: "candor-v1",
    endpoint: "https://api.example.com/api/self/verify",
    endpointType: "staging_https",
    chainID: 11142220,
    userId, userIdType: "uuid", version: 2,
    disclosures: {
      minimumAge: 18,
      ofac: true,
      nationality: false,
      excludedCountries: [],
    },
  }).build(), [userId]);
  return <SelfQRcodeWrapper selfApp={selfApp}
    onSuccess={() => { /* Poll OUR server for the session's verified status. */ }}
    onError={({ reason }) => console.error(reason ?? "Verification failed")}
  />;
}
```

**Exact runtime export spelling is `SelfQRcodeWrapper` / `SelfQRcode`**, lowercase `c` in `code`; some documentation prose says `SelfQRCodeWrapper`, which is not the published export. `SelfAppBuilder` is re-exported from `@selfxyz/sdk-common`; its signature is `constructor(config: Partial<SelfApp>); build(): SelfApp`. Both `onSuccess` and `onError` are required by the published component types. [Published QR entry point](https://unpkg.com/@selfxyz/qrcode@1.0.25/dist/esm/index.d.ts), [QR reference](https://docs.self.xyz/docs/self-pass/frontend/qrcode-sdk-api-reference/).

Disclosures default to absent/false. `minimumAge` proves a threshold without requesting DOB; docs specify up to 99. `ofac:true` requests sanctions checks. `nationality:false` avoids nationality disclosure; **`excludedCountries:["USA", ...]` is a separate exclusion predicate**, using ISO alpha-3 codes, not a request to reveal nationality. Keep frontend predicates and backend config identical. More than 40 excluded countries is documented as problematic. Do not enable name, document number, DOB, gender, or nationality for Candor unless actually needed.

`userIdType` is **`"uuid" | "hex"`**. The builder validates UUID versions 1–5; `crypto.randomUUID()` supplies v4. Hex input must start `0x`; the builder removes that prefix in the built config. A wallet address is possible, but an opaque UUID avoids attaching a public wallet identity to the verification session. `userId` is application context, **not** the nullifier. `userDefinedData` is optional string context, default `""`; the backend result exposes its hex bytes, so decode deliberately if using UTF-8 application data.

The builder generates a random `sessionId`; avoid rebuilding it every render. Browser-only rendering is appropriate; if SSR encounters browser dependencies, load the QR component with `next/dynamic(..., {ssr:false})` from a client component. No Next.js bundling experiment was run.

## Backend constructor, signature, and result

Verified in `@selfxyz/core@1.2.0-beta.1/dist/index.d.ts`:

```typescript
new SelfBackendVerifier(
  scope: string,
  endpoint: string,
  mockPassport: boolean,
  allowedIds: Map<AttestationId, boolean>,
  configStorage: IConfigStorage,
  userIdentifierType: "uuid" | "hex",
);
// Runtime default for mockPassport is false, but supply all six arguments.
verifier.verify(
  attestationId: AttestationId,
  proof: { a: [BigNumberish, BigNumberish];
           b: [[BigNumberish, BigNumberish], [BigNumberish, BigNumberish]];
           c: [BigNumberish, BigNumberish] },
  pubSignals: BigNumberish[],
  userContextData: string,
): Promise<VerificationResult>;
```

`AttestationId` is a **type**, not a runtime enum. Import **`ATTESTATION_ID.PASSPORT`** (1), `BIOMETRIC_ID_CARD` (2), `AADHAAR` (3), or `SELFRICA_ID_CARD` (4) from core. Docs call type 4 “KYC”; the published constant remains `SELFRICA_ID_CARD`. `AllIds` is exported but permits every supported document type; use an explicit allowlist for a passport-only flow.

Beta.3 adds a seventh optional argument **`maxProofAgeSeconds?: number`**, default **86400**. Circuit dates have day granularity, so effective acceptance can include up to another 24 hours; future dates more than one day ahead fail. It also emits a deprecation warning. Do not assume this argument exists in beta.1.

```typescript
type VerificationResult = {
  attestationId: 1 | 2 | 3 | 4;
  isValidDetails: {
    isValid: boolean;
    isMinimumAgeValid: boolean;
    isOfacValid: boolean; // TRUE MEANS A SANCTIONS MATCH in these releases!
  };
  forbiddenCountriesList: string[];
  discloseOutput: {
    nullifier: string;
    forbiddenCountriesListPacked: string[];
    issuingState: string; name: string; idNumber: string; nationality: string;
    dateOfBirth: string; gender: string; expiryDate: string;
    minimumAge: string; // published SDK uses minimumAge, not docs' olderThan
    ofac: boolean[];
  };
  userData: { userIdentifier: string; userDefinedData: string };
};
```

`DefaultConfigStore({minimumAge, excludedCountries, ofac})` is exported directly; tutorial-relative imports are unnecessary. `verify()` checks configuration, scope, context, registry roots and the proof through Celo RPC/contract **read calls**. Off-chain verification means no transaction/gas is required from your server; it does **not** mean offline verification. Config mismatch can throw `ConfigMismatchError` with `.issues`; registry/verifier failures also throw. The caller must check result policy flags.

## Relayer HTTP endpoint

Minimal Node-compatible Request/Response handler (also usable as a Next.js server route). Set `runtime="nodejs"` in Next.js, not Edge. Backend SDK module initialization is source-verified, not runtime-tested due to the dependency block above.

```typescript
import { SelfBackendVerifier, DefaultConfigStore, ATTESTATION_ID } from "@selfxyz/core";
export const runtime = "nodejs";
const verifier = new SelfBackendVerifier(
  process.env.SELF_SCOPE!, process.env.SELF_ENDPOINT!,
  process.env.SELF_MOCK_PASSPORT === "true",
  new Map([[ATTESTATION_ID.PASSPORT, true]]),
  new DefaultConfigStore({ minimumAge: 18, ofac: true, excludedCountries: [] }),
  "uuid",
);
const reply = (ok: boolean, reason?: string) => Response.json(
  ok ? { status: "success", result: true }
     : { status: "error", result: false, reason: reason ?? "Verification failed" },
  { status: 200 },
);
export async function POST(request: Request): Promise<Response> {
  try {
    const b = await request.json();
    if (b.attestationId !== ATTESTATION_ID.PASSPORT || !b.proof ||
        !Array.isArray(b.publicSignals) || typeof b.userContextData !== "string") {
      return reply(false, "Invalid proof request");
    }
    const r = await verifier.verify(b.attestationId, b.proof,
                                    b.publicSignals, b.userContextData);
    const d = r.isValidDetails;
    if (!d.isValid || !d.isMinimumAgeValid || d.isOfacValid) return reply(false);
    // Admission integration point: atomically bind r.discloseOutput.nullifier
    // to the pending session r.userData.userIdentifier and persist success.
    return reply(true);
  } catch {
    return reply(false); // Do not echo raw proof or sensitive exception details.
  }
}
```

Relayer POST uses JSON keys **`attestationId`, `proof`, `publicSignals`, `userContextData`** (`publicSignals`, not `pubSignals`, on HTTP). `userContextData` is packed hex, handled by the SDK; don't synthesize it from an untrusted separate userId. The relayer contract expects **HTTP 200 for both valid and invalid proofs**, with `{status:"success",result:true}` or `{status:"error",result:false,reason:"..."}`. A frontend success callback alone must never grant access. The minimal handler checks proof policy; production admission still needs the marked atomic session/nullifier persistence step. [Backend integration and relayer contract](https://docs.self.xyz/docs/self-pass/backend/basic-integration/).

## Scope, nullifiers, and replay protection

- The frontend field `scope` is a **scope seed**, not a numeric proof scope. In these SDKs, backend `hashEndpointWithScope(endpoint, seed)` strips `http(s)://` and the URL path, then Poseidon-hashes the remaining host (including any explicit port) with the ASCII seed. Identical host+seed therefore gives the same proof scope even across different paths; different subdomains, ports, or seeds change it. Keep the entire configured endpoint identical for routing and use a stable host.
- Maximum accepted builder seed length is **31 ASCII characters**. The API docs also say 30 in one place; inspected implementation rejects only `length > 31`. Use a short value such as `candor-v1`.
- **Disclosure/action nullifiers are scoped:** derived with Poseidon from the user's secret and application scope. Same secret+scope gives the same nullifier; different scope changes it. Distinguish this from the separate document-registration nullifier. Do not describe it as a globally stable person identifier.
- A nullifier does not consume itself. Maintain an atomic uniqueness constraint for the appropriate app/action and bind verified context to a pending, unexpired session. Handle relayer retries idempotently. If repeat login is intended, recognize the existing nullifier rather than blanket-rejecting every repeated proof.
- Changing a tunnel hostname changes scope and hence nullifiers. A UUID change by itself is not a new person. Never use a claimed userId or HTTP success alone for uniqueness.

Sources: [architecture](https://docs.self.xyz/docs/self-pass/architecture/zk-proof-architecture/), [published scope implementation](https://unpkg.com/@selfxyz/common@0.0.9/dist/esm/src/utils/scope.js), [core beta.1 types](https://unpkg.com/@selfxyz/core@1.2.0-beta.1/dist/index.d.ts), [core beta.3 types](https://unpkg.com/@selfxyz/core@1.2.0-beta.3/dist/index.d.ts), [core implementation](https://unpkg.com/@selfxyz/core@1.2.0-beta.1/dist/index.js).

## Environments and testing without a passport

| Setting | Mock/staging | Real/mainnet |
|---|---|---|
| Frontend `endpointType` | `staging_https` | `https` |
| Backend `mockPassport` | `true` | `false` |
| Celo network/chain ID | Celo Sepolia / `11142220` | Celo / `42220` |
| Built-in RPC | `https://forno.celo-sepolia.celo-testnet.org` | `https://forno.celo.org` |

Use **public HTTPS** for the callback; localhost is explicitly rejected by the builder and cannot be reached by Self's relayer. Production `endpointType:"https"` enforces the `https://` prefix. `staging_https` does not enforce that prefix in the inspected builder, but still needs a publicly routable endpoint; use an HTTPS tunnel for development. No RPC URL constructor override exists in these versions. The example environment names (`SELF_SCOPE`, `SELF_ENDPOINT`, `SELF_MOCK_PASSPORT`) are application choices, not automatically consumed SDK variables.

Generate a mock document in the Self mobile app: Settings → Manage ID documents → Generate Mock Document; choose age/nationality/OFAC attributes. Mock documents work only in staging; real documents use production. No real passport or paid on-chain transaction is needed for this off-chain test. [Mock-document guide](https://docs.self.xyz/docs/self-enterprise/guides/using-mock-passports/), [environment selection](https://docs.self.xyz/docs/self-pass/key-concepts/).

Observed QR gotcha: `sdk-common@1.0.1` defaults `chainID` to testnet only for `staging_celo`, leaving `staging_https` at 42220. The snippet explicitly sets 11142220 for consistent staging context; this configuration built successfully but the mobile proof loop was not exercised. Mainnet should explicitly use 42220.

No official Python self-hosted verifier SDK was found in the linked documentation/repository. Keep the verifier in Node and expose a narrow internal result interface to Python. The managed successor's verified npm name is `@selfxyz/enterprise-sdk` (not `@selfxyz/enterprise`); its API starts with `new SelfClient({apiKey: process.env.SELF_API_KEY!})`, then `self.sessions.create({flowId, externalUuid})`, returning a hosted `verificationUrl`. Test/live keys start `sk_test_` / `sk_live_`; this replaces local QR/verifier operation and requires webhook signature verification. [Enterprise Node SDK](https://docs.self.xyz/docs/self-enterprise/sdk/nodejs/).

## Local evidence

All artifacts/install attempts were under a disposable `%TEMP%` directory. Ran ESM `import {SelfAppBuilder} from "@selfxyz/qrcode"`; `.build()` returned a generated `sessionId`, requested `staging_https`, UUID user ID, version 2, and `{minimumAge:18,ofac:true,nationality:false,excludedCountries:[]}`. The default-chain discrepancy above was observed directly; a second run with explicit `chainID:11142220` returned that ID and confirmed `typeof SelfQRcodeWrapper === "function"`. Installed React/ReactDOM peers were 18.3.1 (not asserted to be latest). No mobile scan, full backend proof verification, live relayer callback, or Enterprise session creation was performed.
