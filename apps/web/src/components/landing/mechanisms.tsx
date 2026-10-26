type Mechanism = {
  name: string;
  reference: string;
  does: string;
  defends: string;
  path: string;
};

const groups: { title: string; items: Mechanism[] }[] = [
  {
    title: "Proving you are a person",
    items: [
      {
        name: "Zero-knowledge passport proof",
        reference: "Self · scoped nullifier",
        does: "The Self app reads your passport chip and proves, on your phone, that it is genuine and that you are over 18. Candor receives a nullifier scoped to one campaign and keeps only an HMAC of it.",
        defends:
          "One person flooding a campaign with reports (3 tokens per 30 days), and linking your reports across organisations.",
        path: "services/identity/src/self.ts",
      },
      {
        name: "Blind signatures",
        reference: "RFC 9474 · RSABSSA-SHA384-PSS",
        does: "Your browser blinds three random tokens, the identity service signs them without seeing them, and your browser unblinds the signatures.",
        defends:
          "Matching the verification to the report, even if the identity service and the report API pool their records.",
        path: "packages/crypto/src/blind.ts",
      },
    ],
  },
  {
    title: "Before anything leaves your device",
    items: [
      {
        name: "Metadata stripping and pseudonymisation",
        reference: "In the browser · pdf-lib, JSZip, postal-mime",
        does: "Author fields, GPS tags, Message-IDs and originating-IP headers are removed. Names, emails and IDs become consistent placeholders; your own name becomes [REDACTED].",
        defends:
          "Being identified by a file’s hidden properties, or by names in the evidence reaching the server or the model.",
        path: "packages/privacy/src/files.ts",
      },
      {
        name: "Padmé padding",
        reference: "Nikitin et al., PETS 2019",
        does: "Every plaintext is length-framed and padded to a Padmé boundary before encryption, costing at most about 12% in size.",
        defends: "Recognising a file by its exact size. Length leaks at most O(log log M) bits.",
        path: "packages/crypto/src/encoding.ts",
      },
      {
        name: "Authenticated envelopes",
        reference: "XChaCha20-Poly1305 · 24-byte random nonces",
        does: "Each file, manifest and analysis payload is encrypted with associated data that binds it to its report and purpose, such as candor/v1/file/0/‹report›.",
        defends:
          "Reading or altering stored evidence, and swapping ciphertext between reports or fields.",
        path: "packages/crypto/src/envelopes.ts",
      },
    ],
  },
  {
    title: "In custody",
    items: [
      {
        name: "Threshold key custody",
        reference: "Shamir k-of-n over GF(256)",
        does: "The report key is split 2-of-3 and each share is sealed to one reviewer’s X25519 key. Shares are only ever combined in a reviewer’s browser.",
        defends:
          "One curious, coerced or compromised reviewer opening originals or real names alone.",
        path: "packages/crypto/src/envelopes.ts",
      },
      {
        name: "Transparency log",
        reference: "RFC 9162 Merkle tree · Ed25519 tree heads",
        does: "Every submission, analysis, opening and approval is appended. Each tree head is signed, and roots are anchored on-chain every 16 entries.",
        defends:
          "Quietly opening evidence, or rewriting the record later. Inclusion and consistency proofs let anyone check.",
        path: "services/api/src/candor_api/audit.py",
      },
    ],
  },
  {
    title: "During analysis",
    items: [
      {
        name: "Prompt-injection quarantine",
        reference: "Spotlighting with per-run nonces",
        does: "Evidence is wrapped in nonce-tagged delimiters and scored by heuristics and a classifier. Passages at 0.7 or above are quarantined and cannot support a claim on their own.",
        defends:
          "A planted document telling the model to ignore its instructions or to report that nothing went wrong.",
        path: "services/pipeline/src/candor_pipeline/stages/injection_scan.py",
      },
      {
        name: "Timeline constraint solving",
        reference: "Simple Temporal Network · Floyd–Warshall",
        does: "Every date and every “before” or “after” becomes a constraint between day numbers. A negative cycle means they cannot all be true.",
        defends:
          "A timeline that reads smoothly but is impossible. The conflicting statements are named, with their sources.",
        path: "services/pipeline/src/candor_pipeline/temporal/stn.py",
      },
    ],
  },
  {
    title: "Paying for analysis",
    items: [
      {
        name: "Pay-per-analysis",
        reference: "x402 · USDC on Base Sepolia",
        does: "The analysis endpoint answers 402 Payment Required and the organisation’s wallet pays per run. Payment records sit in their own database, linked to jobs only by a keyed HMAC.",
        defends: "Reporters having to pay, which would leave a financial trail back to them.",
        path: "services/api/src/candor_api/payments.py",
      },
    ],
  },
];

export function Mechanisms() {
  return (
    <section
      aria-labelledby="proofs-title"
      className="mx-auto w-full max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
        <h2 id="proofs-title" className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
          Proofs, not promises
        </h2>
        <p className="max-w-[60ch] text-md text-ink-2">
          Each protection is a specific, published mechanism with a specific job. Here is what each
          one does, what it stops, and where it lives in the code.
        </p>
      </div>

      <div
        className="mt-12 hidden grid-cols-[11rem_minmax(0,15rem)_minmax(0,1fr)_minmax(0,1fr)] gap-x-8 border-b border-line-strong pb-3 text-xs font-medium text-ink-2 lg:grid"
        aria-hidden="true"
      >
        <span>When</span>
        <span>Mechanism</span>
        <span>What it does</span>
        <span>What it defends against</span>
      </div>

      <div className="mt-10 flex flex-col lg:mt-0">
        {groups.map((group) => (
          <div
            key={group.title}
            className="grid gap-x-8 border-b border-line py-6 last:border-b-0 lg:grid-cols-[11rem_minmax(0,1fr)] lg:py-0"
          >
            <h3 className="pb-2 text-sm font-semibold text-ink-2 lg:py-6">{group.title}</h3>
            <dl className="flex flex-col divide-y divide-line">
              {group.items.map((item) => (
                <div
                  key={item.name}
                  className="grid gap-x-8 gap-y-2 py-4 first:pt-2 last:pb-0 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,1fr)] lg:py-6 lg:first:pt-6 lg:last:pb-6"
                >
                  <dt>
                    <span className="block text-md font-semibold text-ink">{item.name}</span>
                    <span className="mt-0.5 block text-xs text-ink-2">{item.reference}</span>
                    <code className="mt-2 block font-mono text-2xs break-all text-ink-3">
                      {item.path}
                    </code>
                  </dt>
                  <dd className="text-base text-ink-2">
                    <span className="sr-only">What it does: </span>
                    {item.does}
                  </dd>
                  <dd className="text-base text-ink">
                    <span className="mr-1.5 text-xs font-medium text-seal-ink lg:sr-only">
                      Defends against
                    </span>
                    {item.defends}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
