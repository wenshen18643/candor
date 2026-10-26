import { CustodyDiagram, TrustDiagram, trustEdges } from "./diagrams";
import {
  ArchSection,
  C,
  CodeBlock,
  FactList,
  Figure,
  Prose,
  ResponsiveTable,
  Steps,
  SubHeading,
  WideVisual,
} from "./primitives";
import {
  type Lifeline,
  SequenceDiagram,
  type SequenceStep,
  SequenceText,
} from "./sequence-diagram";

const domains = [
  {
    name: "Reporter’s browser",
    holds: "Originals, the name map, K_r and K_a until upload, codename-derived inbox keys",
    never: "Anything on a server in plain text",
  },
  {
    name: "Identity service",
    holds: "Per-campaign RSA issuer keys, HMAC nullifier tags, 15-minute sessions",
    never: "Reports, evidence, payments, raw proofs, passport data",
  },
  {
    name: "Report API",
    holds: "Ciphertext, sealed key shares, the job queue, the log, the payments ledger",
    never: "Plaintext evidence, or any key that can open it",
  },
  {
    name: "Analysis worker",
    holds: "The enclave X25519 key; the redacted analysis view, in memory",
    never: "Originals, the name map, identity data",
  },
  {
    name: "Reviewers’ browsers",
    holds: "X25519 and Ed25519 private keys; one Shamir share each",
    never: "The reporter’s identity",
  },
];

export function TrustSection() {
  return (
    <ArchSection
      id="trust-domains"
      summary="No single part of Candor can connect a person to a report."
      title="Trust domains"
      lead="Candor is split so that no single service can connect a person to a report. Each box is a separate trust domain with its own keys and storage, and the arrows carry only what is written on them."
      sources={[
        "docs/specs/00-overview.md",
        "services/identity/src/store.ts",
        "services/api/src/candor_api/database.py",
        "services/api/src/candor_api/payments.py",
      ]}
    >
      <Figure
        visual={<TrustDiagram />}
        alternative={
          <ul className="flex flex-col gap-2.5 text-sm text-ink-2">
            {trustEdges.map((edge) => (
              <li key={`${edge.from}-${edge.to}`}>
                <span className="font-medium text-ink">
                  {edge.from} → {edge.to}:
                </span>{" "}
                {edge.carries}
              </li>
            ))}
          </ul>
        }
        caption="The seal-coloured path is the only exchange between the reporter and the identity service. The worker is the only place redacted text exists in plain form outside the reporter’s device."
      />
      <ResponsiveTable
        caption="What each trust domain holds and never holds"
        columns={["Domain", "Holds", "Never holds"]}
        emphasizeLast
        rows={domains.map((domain) => ({
          key: domain.name,
          head: domain.name,
          cells: [domain.holds, domain.never],
        }))}
      />
      <FactList
        items={[
          {
            term: "Three databases, no joins",
            detail: (
              <>
                <C>identity.db</C>, <C>reports.db</C> with <C>audit.db</C>, and <C>payments.db</C>{" "}
                share no keys and no foreign keys. Payments reach jobs only through{" "}
                <C>HMAC-SHA256(link key, job_id)</C>.
              </>
            ),
          },
          {
            term: "One fact for identity",
            detail:
              "The identity service learns that a verified person asked for tokens for one campaign, and nothing else.",
          },
          {
            term: "Ciphertext at rest",
            detail:
              "The API stores envelopes it cannot open: originals under the report key, the analysis view sealed to the worker, findings sealed to reviewers.",
          },
          {
            term: "Every access logged",
            detail:
              "Openings, file fetches, access requests, approvals and grants are appended to a signed Merkle log.",
          },
        ]}
      />
    </ArchSection>
  );
}

const identityLifelines: Lifeline[] = [
  { id: "browser", label: "Browser", sub: "apps/web" },
  { id: "self", label: "Self app", sub: "reporter’s phone" },
  { id: "identity", label: "Identity service", sub: "services/identity" },
  { id: "api", label: "Report API", sub: "services/api" },
];

const identitySteps: SequenceStep[] = [
  {
    kind: "message",
    from: "browser",
    to: "identity",
    label: "Open a verification session",
    detail: "POST /v1/sessions",
  },
  {
    kind: "message",
    from: "identity",
    to: "browser",
    label: "Session id, Self scope",
    detail: "scope = candor-<campaign>",
    reply: true,
  },
  {
    kind: "message",
    from: "browser",
    to: "self",
    label: "QR code",
    detail: "scope, session, age ≥ 18",
  },
  {
    kind: "note",
    at: "self",
    lines: ["Reads the passport chip over NFC", "Builds a zero-knowledge proof on the phone"],
  },
  {
    kind: "message",
    from: "self",
    to: "identity",
    label: "Proof + scoped nullifier",
    detail: "via the Self relayer",
  },
  {
    kind: "note",
    at: "identity",
    lines: [
      "Verifies the proof, then keeps only",
      "HMAC(secret, campaign | epoch | nullifier)",
      "Quota: 3 tokens per 30-day epoch",
    ],
  },
  {
    kind: "message",
    from: "identity",
    to: "browser",
    label: "Verified, allowance 3",
    detail: "GET /v1/sessions/{id}",
    reply: true,
  },
  {
    kind: "note",
    at: "browser",
    lines: ["msg = random(32); prepared = prefix ‖ msg", "Blind(pk, prepared) → blindedMsg, inv"],
  },
  {
    kind: "message",
    from: "browser",
    to: "identity",
    label: "3 blinded messages",
    detail: "POST /v1/sessions/{id}/issue",
    emphasis: true,
  },
  {
    kind: "note",
    at: "identity",
    lines: ["BlindSign with the RSA-2048 issuer key", "It sees only blinded bytes"],
  },
  {
    kind: "message",
    from: "identity",
    to: "browser",
    label: "3 blind signatures",
    detail: "session consumed",
    reply: true,
    emphasis: true,
  },
  {
    kind: "note",
    at: "browser",
    lines: [
      "Finalize(prepared, blindSig, inv) → signature",
      "token = { key_id, prepared, signature }",
      "inv is discarded; waits 2–20 s of jitter",
    ],
  },
  {
    kind: "message",
    from: "browser",
    to: "api",
    label: "Report with one token",
    detail: "POST /v1/reports",
    emphasis: true,
  },
  {
    kind: "note",
    at: "api",
    lines: [
      "RSASSA-PSS verify: SHA-384, salt 48",
      "Spent? key = sha256(prepared)",
      "Append report.submitted",
    ],
  },
  {
    kind: "message",
    from: "api",
    to: "browser",
    label: "201 receipt",
    detail: "evidence root, log index, tree head",
    reply: true,
  },
];

export function IdentitySection() {
  return (
    <ArchSection
      id="identity"
      summary="Prove you're a real adult once, then report with tokens nobody can trace back to you."
      title="Identity without identification"
      lead="A reporter proves once per campaign that they are a real adult with a genuine passport, and leaves with three tokens that cannot be traced back to that proof."
      sources={[
        "docs/specs/03-identity.md",
        "services/identity/src/self.ts",
        "services/identity/src/crypto.ts",
        "services/identity/src/service.ts",
        "packages/crypto/src/blind.ts",
        "services/api/src/candor_api/reports.py",
      ]}
    >
      <Figure
        visual={
          <SequenceDiagram
            id="identity-seq"
            title="Identity flow as a sequence diagram between the browser, the Self app, the identity service and the report API."
            lifelines={identityLifelines}
            steps={identitySteps}
          />
        }
        alternative={<SequenceText lifelines={identityLifelines} steps={identitySteps} />}
        caption="Seal-coloured messages carry the blind-token exchange and its redemption. Dashed arrows are replies."
      />
      <Prose>
        <p>
          <strong>Why the two halves cannot be joined.</strong> The identity service only ever sees{" "}
          <C>blindedMsg</C>, which is <C>prepared</C> multiplied by a random factor raised to the
          issuer’s public exponent. The API only ever sees <C>prepared</C> and its finished
          signature. The factor (<C>inv</C>) lives in browser memory and is thrown away after
          finalising, so even with both services’ complete databases a signing cannot be matched to
          a redemption. RFC 9474 blindness holds against the signer itself.
        </p>
        <p>
          <strong>What is left is timing.</strong> If a reporter verified and submitted within the
          same second, an operator watching both services could guess. The browser waits 2 to 20
          seconds of random jitter, and tokens stay valid for the campaign’s 30-day epoch, so
          verifying today and reporting next week is the safer pattern.
        </p>
      </Prose>
      <FactList
        items={[
          {
            term: "Scoped nullifiers",
            detail:
              "The Self scope is per campaign, so the same passport yields different nullifiers for different organisations. Reports to two organisations cannot be linked through identity.",
          },
          {
            term: "Rate limit",
            detail:
              "Three tokens per person per campaign per 30 days. A fourth request in the same epoch is refused with quota_exhausted.",
          },
          {
            term: "Issuer keys",
            detail:
              "RSA-2048, e = 65537, one per campaign, generated with @cloudflare/blindrsa-ts and encrypted at rest with AES-256-GCM under an HKDF-derived key.",
          },
          {
            term: "Redemption",
            detail: (
              <>
                Standard RSASSA-PSS verification (SHA-384, MGF1-SHA-384, 48-byte salt). The spent
                registry key is <C>hex(sha256(prepared))</C>; a second use returns{" "}
                <C>409 token_spent</C>.
              </>
            ),
          },
        ]}
      />
    </ArchSection>
  );
}

const metadataRows = [
  {
    format: "PDF",
    removed:
      "Title, Author, Subject, Keywords, Creator, Producer, creation and modification dates, the XMP metadata stream",
    how: "pdf-lib; text through unpdf",
  },
  {
    format: "Word (.docx)",
    removed:
      "Creator, last modified by, revision, dates, company, manager, template, custom properties; comment and tracked-change authors become “Redacted”",
    how: "JSZip rewrites docProps; text through mammoth",
  },
  {
    format: "Email (.eml)",
    removed:
      "Received, X-Originating-IP, Message-ID, X-Mailer, User-Agent, Return-Path, DKIM-Signature, Authentication-Results",
    how: "postal-mime; re-serialised as a minimal RFC 822 message",
  },
  {
    format: "Images",
    removed: "EXIF, GPS and XMP, listed for the reporter before removal",
    how: "read with exifr, re-encoded through OffscreenCanvas",
  },
  {
    format: "Text, Markdown, CSV",
    removed: "Byte-order marks and zero-width characters, which can fingerprint a copy",
    how: "stripped on decode",
  },
];

export function DeviceSection() {
  return (
    <ArchSection
      id="on-device"
      summary="Names and hidden file details are removed in the reporter's browser before upload."
      showFirst={false}
      title="On-device privacy"
      lead="Everything here runs in the reporter’s browser before a single byte is uploaded. The server never sees the before."
      sources={[
        "docs/specs/07-client-packages.md",
        "packages/privacy/src/files.ts",
        "packages/privacy/src/detect.ts",
        "packages/privacy/src/scrub.ts",
        "packages/privacy/src/analysis.ts",
      ]}
    >
      <div className="flex flex-col gap-4">
        <SubHeading>Metadata stripping</SubHeading>
        <ResponsiveTable
          caption="Metadata removed per file format"
          columns={["Format", "Removed", "How"]}
          rows={metadataRows.map((row) => ({
            key: row.format,
            head: row.format,
            cells: [row.removed, row.how],
          }))}
        />
        <Prose>
          <p>
            Email keeps Date, From, To, Cc and Subject, because they matter as evidence; they then
            go through identifier detection like any other text. For supported formats the list of
            remaining metadata must be empty before the reporter can continue.
          </p>
        </Prose>
      </div>
      <div className="flex flex-col gap-4">
        <SubHeading>Detection and pseudonymisation</SubHeading>
        <Prose>
          <p>
            Regex families catch emails, phone numbers (libphonenumber-js), IBANs with checksum,
            card numbers with a Luhn check, SSN-like numbers, IP addresses, URLs, staff IDs such as{" "}
            <C>EMP-12345</C> and dates of birth near “DOB”. The compromise NER model finds people,
            organisations and places. The reporter’s own self terms, and their variants, are matched
            case-insensitively and always win.
          </p>
          <p>
            Each identifier becomes a consistent placeholder: <C>PERSON_1</C>, <C>ORG_2</C>,{" "}
            <C>EMAIL_1</C>. A first name or surname on its own links to the full-name placeholder
            when unambiguous, and an email whose local part matches a person joins that person’s
            family. Self terms become <C>[REDACTED]</C>. The map from placeholder to real name goes
            into the manifest, encrypted under the report key.
          </p>
        </Prose>
      </div>
      <div className="flex flex-col gap-4">
        <SubHeading>Leakage score</SubHeading>
        <Prose>
          <p>
            Before submitting, the reporter sees a 0 to 100 score with plain-English notes on what
            drives it. Remaining self-term fragments add 40 each, emails and phone numbers 25, names
            15, and quasi-identifiers 5 each: job titles with team names, small exact headcounts,
            rare locations, exact timestamps, or first-person role statements like “as the only
            nurse on night shift”. Below 15 is low, below 40 elevated, otherwise high.
          </p>
          <p>
            Timing is treated the same way. Reporter-facing log entries use hour buckets, and the
            client can send same-sized chaff to <C>POST /v1/chaff</C>.
          </p>
        </Prose>
      </div>
    </ArchSection>
  );
}

export function CustodySection({
  padme,
}: {
  padme: { plain: number; framed: number; padded: number; sealed: number };
}) {
  const exponent = Math.floor(Math.log2(padme.framed));
  const size = Math.floor(Math.log2(exponent)) + 1;
  return (
    <ArchSection
      id="custody"
      summary="Files are locked with keys only the right people hold. The server can open none of them."
      title="Envelope encryption and threshold custody"
      lead="Three symmetric keys, each wrapped only for the parties that need it. The API stores every envelope and can open none of them."
      sources={[
        "docs/specs/01-protocols.md",
        "packages/crypto/src/envelopes.ts",
        "packages/crypto/src/encoding.ts",
        "services/api/src/candor_api/custody.py",
        "services/pipeline/src/candor_pipeline/crypto.py",
      ]}
    >
      <Figure
        mode="always"
        visual={
          <WideVisual label="Key custody diagram">
            <CustodyDiagram />
          </WideVisual>
        }
        alternative={
          <ul className="flex flex-col gap-2.5 text-sm text-ink-2">
            <li>
              <span className="font-medium text-ink">K_r, the report key:</span> encrypts the
              manifest, the name map and the original files. Split 2-of-3 with Shamir over GF(256);
              each share is sealed to one reviewer’s X25519 key. Any two reviewers can rebuild it,
              in a browser, and the access is logged.
            </li>
            <li>
              <span className="font-medium text-ink">K_a, the analysis key:</span> encrypts the
              redacted analysis payload and is sealed to the worker’s enclave key. Only the worker
              opens it, in memory.
            </li>
            <li>
              <span className="font-medium text-ink">K_f, the findings key:</span> created by the
              worker, encrypts the findings and is sealed separately to every reviewer.
            </li>
          </ul>
        }
        caption="All three keys are 32 random bytes. Envelopes are XChaCha20-Poly1305 with a fresh 24-byte nonce; key wraps are libsodium sealed boxes."
      />
      <div className="flex flex-col gap-4">
        <SubHeading>Opening the originals takes two people</SubHeading>
        <Steps
          items={[
            <>
              <strong>A reviewer asks.</strong> Morgan opens an access request with a reason;{" "}
              <C>access.requested</C> is logged.
            </>,
            <>
              <strong>A second reviewer approves in their browser.</strong> Avery unseals their own
              share, reseals it to Morgan’s X25519 key, and signs a <C>candor/v1/approve</C> message
              naming the request, report and requester with Ed25519.
            </>,
            <>
              <strong>The API checks the signature, not the share.</strong> It verifies the Ed25519
              signature, refuses self-approval, and marks the request granted once approvals reach
              threshold − 1; <C>access.granted</C> is logged.
            </>,
            <>
              <strong>Morgan combines locally.</strong> Morgan’s own share plus Avery’s resealed
              share rebuild K_r in Morgan’s browser, which decrypts the manifest and files. Python
              never parses a share.
            </>,
          ]}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <SubHeading>Envelope format</SubHeading>
          <CodeBlock label="CandorBox JSON format">
            {`{
  "v": 1,
  "alg": "xc20p-padme",
  "n": "<b64u 24-byte nonce>",
  "c": "<b64u ciphertext>"
}

AD = "candor/v1/" + purpose + "/" + report_id
purpose ∈ manifest | file/<i> | analysis | findings`}
          </CodeBlock>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <SubHeading>Padmé, worked</SubHeading>
          <CodeBlock label="Padmé padding calculation">
            {`F = u32be(len(P)) ‖ P        L = len(F)
E = ⌊log2 L⌋   S = ⌊log2 E⌋ + 1   z = E − S
padded = ⌈L / 2^z⌉ · 2^z

The email in the hero:
P = ${padme.plain} B → L = ${padme.framed}
E = ${exponent}, S = ${size}, z = ${exponent - size}
padded = ${padme.padded} B, sealed = ${padme.sealed} B (+16 tag)`}
          </CodeBlock>
        </div>
      </div>
    </ArchSection>
  );
}
