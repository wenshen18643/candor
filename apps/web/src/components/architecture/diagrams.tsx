import { cn } from "@/lib/cn";

type BoxProps = {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  lines?: string[];
  tone?: "plain" | "seal" | "muted";
};

function Box({ x, y, w, h, title, sub, lines = [], tone = "plain" }: BoxProps) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        className={cn(
          tone === "seal" && "fill-seal-soft stroke-seal",
          tone === "plain" && "fill-bg stroke-ink-3/40",
          tone === "muted" && "fill-surface-2 stroke-line",
        )}
      />
      <text
        x={x + 12}
        y={y + 22}
        className={cn(
          "text-[13.5px] font-semibold",
          tone === "seal" ? "fill-seal-ink" : "fill-ink",
        )}
      >
        {title}
      </text>
      {sub ? (
        <text x={x + 12} y={y + 38} className="fill-ink-3 font-mono text-[10.5px]">
          {sub}
        </text>
      ) : null}
      {lines.map((line, index) => (
        <text key={line} x={x + 12} y={y + 58 + index * 15} className="fill-ink-2 text-[11.5px]">
          {line}
        </text>
      ))}
    </g>
  );
}

function Arrowheads({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={`${id}-a`}
        viewBox="0 0 8 8"
        refX="7"
        refY="4"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M0 0L8 4L0 8z" className="fill-ink-2" />
      </marker>
      <marker
        id={`${id}-s`}
        viewBox="0 0 8 8"
        refX="7"
        refY="4"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M0 0L8 4L0 8z" className="fill-seal" />
      </marker>
    </defs>
  );
}

function Label({
  x,
  y,
  children,
  anchor = "middle",
  mono = false,
}: {
  x: number;
  y: number;
  children: string;
  anchor?: "start" | "middle" | "end";
  mono?: boolean;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      className={cn("fill-ink-2", mono ? "font-mono text-[10.5px]" : "text-[11.5px]")}
    >
      {children}
    </text>
  );
}

export const trustEdges = [
  {
    from: "Self app",
    to: "Identity service",
    carries: "A zero-knowledge proof and a campaign-scoped nullifier, through the Self relayer.",
  },
  {
    from: "Reporter’s browser",
    to: "Identity service",
    carries: "Session requests and three blinded token messages; three blind signatures come back.",
  },
  {
    from: "Reporter’s browser",
    to: "Report API",
    carries: "Ciphertext, sealed key shares, a sealed analysis key and one unblinded token.",
  },
  {
    from: "Report API",
    to: "Reviewers’ browsers",
    carries: "Sealed shares, sealed findings keys, approvals and resealed shares.",
  },
  {
    from: "Report API",
    to: "Analysis worker",
    carries: "The sealed analysis box out; sealed findings back. No reviewer or reporter identity.",
  },
  {
    from: "Analysis worker",
    to: "Model provider",
    carries: "Redacted, pseudonymised passages inside spotlighting delimiters.",
  },
  {
    from: "Report API",
    to: "Anyone",
    carries: "Signed tree heads, log entries, inclusion and consistency proofs, anchors.",
  },
];

export function TrustDiagram() {
  const id = "trust";
  return (
    <svg
      viewBox="0 0 760 452"
      className="h-auto w-full"
      role="img"
      aria-label="Trust domains. The Self app sends a proof to the identity service. The reporter's browser exchanges blinded tokens with the identity service and sends ciphertext, sealed shares and one token to the report API. The API exchanges sealed material with reviewers' browsers and the analysis worker, which sends redacted prompts to the model provider. The API publishes signed tree heads to anyone."
      fill="none"
    >
      <Arrowheads id={id} />
      <rect
        x={8}
        y={8}
        width={196}
        height={262}
        rx={12}
        className="stroke-ink-3/60"
        strokeDasharray="4 5"
      />
      <text x={20} y={262} className="fill-ink-3 text-[11px]">
        Reporter’s device
      </text>

      <Box x={20} y={20} w={172} h={64} title="Self app" sub="on the reporter’s phone" />
      <Box
        x={20}
        y={160}
        w={172}
        h={84}
        title="Reporter’s browser"
        sub="apps/web"
        lines={["strips, redacts, encrypts", "holds K_r, K_a, codename"]}
      />
      <Box
        x={294}
        y={20}
        w={172}
        h={84}
        title="Identity service"
        sub="services/identity"
        lines={["identity.db: HMAC tags", "issuer RSA keys"]}
      />
      <Box
        x={294}
        y={160}
        w={172}
        h={100}
        title="Report API"
        sub="services/api"
        lines={["reports.db, audit.db", "payments.db, blobs", "ciphertext only"]}
      />
      <Box
        x={568}
        y={160}
        w={172}
        h={84}
        title="Reviewers’ browsers"
        sub="X25519 + Ed25519 keys"
        lines={["one Shamir share each", "combine shares locally"]}
      />
      <Box
        x={294}
        y={348}
        w={172}
        h={84}
        title="Analysis worker"
        sub="services/pipeline"
        lines={["enclave X25519 key", "plaintext in memory only"]}
        tone="seal"
      />
      <Box
        x={20}
        y={348}
        w={172}
        h={84}
        title="Model provider"
        sub="Meta Model API"
        lines={["Muse Spark", "redacted prompts only"]}
        tone="muted"
      />
      <Box
        x={568}
        y={348}
        w={172}
        h={84}
        title="Anyone"
        sub="public log readers"
        lines={["verifies tree heads", "and proofs"]}
        tone="muted"
      />

      <path d="M192 52H290" className="stroke-ink-2" markerEnd={`url(#${id}-a)`} />
      <Label x={242} y={44}>
        ZK proof
      </Label>
      <Label x={242} y={70} mono>
        via relayer
      </Label>

      <path
        d="M140 160V132H340V108"
        className="stroke-seal"
        strokeWidth={1.5}
        markerStart={`url(#${id}-s)`}
        markerEnd={`url(#${id}-s)`}
      />
      <Label x={350} y={128} anchor="start">
        blinded tokens ⇄ signatures
      </Label>

      <path d="M192 206H290" className="stroke-ink-2" markerEnd={`url(#${id}-a)`} />
      <Label x={242} y={186}>
        ciphertext,
      </Label>
      <Label x={242} y={199}>
        shares, 1 token
      </Label>

      <path
        d="M466 206H564"
        className="stroke-ink-2"
        markerStart={`url(#${id}-a)`}
        markerEnd={`url(#${id}-a)`}
      />
      <Label x={516} y={186}>
        sealed shares,
      </Label>
      <Label x={516} y={199}>
        findings, approvals
      </Label>

      <path
        d="M352 260V344"
        className="stroke-ink-2"
        markerStart={`url(#${id}-a)`}
        markerEnd={`url(#${id}-a)`}
      />
      <Label x={342} y={296} anchor="end">
        sealed analysis box ↓
      </Label>
      <Label x={342} y={311} anchor="end">
        sealed findings ↑
      </Label>

      <path d="M294 390H196" className="stroke-ink-2" markerEnd={`url(#${id}-a)`} />
      <Label x={245} y={382}>
        redacted prompts
      </Label>

      <path d="M430 260V300H654V344" className="stroke-ink-2" markerEnd={`url(#${id}-a)`} />
      <Label x={560} y={292}>
        signed tree heads, proofs
      </Label>
    </svg>
  );
}

export function CustodyDiagram() {
  const id = "custody";
  const rows = [
    {
      key: "K_r",
      keyNote: "report key",
      data: ["Manifest + name map", "Original files"],
      context: "AD: candor/v1/manifest, file/i",
      recipients: ["Avery · share 1", "Morgan · share 2", "Riley · share 3"],
      via: "Shamir 2-of-3, each share sealed",
      opened: ["Any two reviewers,", "combined in a browser,", "logged publicly"],
      top: 52,
    },
    {
      key: "K_a",
      keyNote: "analysis key",
      data: ["Redacted analysis", "payload"],
      context: "AD: candor/v1/analysis",
      recipients: ["Enclave X25519 key"],
      via: "sealed box",
      opened: ["Analysis worker,", "in memory only"],
      top: 196,
    },
    {
      key: "K_f",
      keyNote: "findings key",
      data: ["Findings", "(AnalysisResult)"],
      context: "AD: candor/v1/findings",
      recipients: ["Avery’s key", "Morgan’s key", "Riley’s key"],
      via: "one sealed copy each",
      opened: ["Each reviewer,", "on their own"],
      top: 272,
    },
  ];
  return (
    <svg
      viewBox="0 0 760 400"
      className="h-auto w-full"
      role="img"
      aria-label="Key custody. K_r encrypts the manifest, name map and original files and is split two of three into shares sealed to three reviewers. K_a encrypts the redacted analysis payload and is sealed to the worker's enclave key. K_f encrypts the findings and is sealed separately to every reviewer."
      fill="none"
    >
      <Arrowheads id={id} />
      {["Plaintext", "Encrypted under", "Key wrapped for", "Who can open it"].map((head, index) => (
        <text
          key={head}
          x={[16, 236, 380, 604][index]}
          y={22}
          className="fill-ink-3 text-[11px] font-medium"
        >
          {head}
        </text>
      ))}
      {rows.map((row) => {
        const recipientHeight = 30;
        const gap = 8;
        const blockHeight =
          row.recipients.length * recipientHeight + (row.recipients.length - 1) * gap;
        const center = row.top + blockHeight / 2;
        return (
          <g key={row.key}>
            <rect
              x={16}
              y={center - 26}
              width={176}
              height={52}
              rx={8}
              className="fill-bg stroke-ink-3/40"
            />
            {row.data.map((line, index) => (
              <text
                key={line}
                x={28}
                y={center - 8 + index * 15}
                className="fill-ink text-[12.5px]"
              >
                {line}
              </text>
            ))}
            <path d={`M192 ${center}H230`} className="stroke-ink-2" markerEnd={`url(#${id}-a)`} />
            <rect
              x={236}
              y={center - 22}
              width={92}
              height={44}
              rx={8}
              className="fill-seal-soft stroke-seal"
            />
            <text
              x={282}
              y={center - 3}
              textAnchor="middle"
              className="fill-seal-ink font-mono text-[14px] font-semibold"
            >
              {row.key}
            </text>
            <text
              x={282}
              y={center + 13}
              textAnchor="middle"
              className="fill-seal-ink text-[10.5px]"
            >
              {row.keyNote}
            </text>
            <text x={18} y={center + 42} className="fill-ink-3 font-mono text-[10px]">
              {row.context}
            </text>
            {row.recipients.map((recipient, index) => {
              const y = row.top + index * (recipientHeight + gap);
              const targetY = y + recipientHeight / 2;
              return (
                <g key={recipient}>
                  <path
                    d={`M328 ${center}C352 ${center} 352 ${targetY} 376 ${targetY}`}
                    className="stroke-ink-2"
                    markerEnd={`url(#${id}-a)`}
                  />
                  <rect
                    x={380}
                    y={y}
                    width={180}
                    height={recipientHeight}
                    rx={6}
                    className="fill-bg stroke-ink-3/40"
                  />
                  <text x={392} y={y + 19} className="fill-ink text-[12px]">
                    {recipient}
                  </text>
                </g>
              );
            })}
            <text
              x={380}
              y={row.top + blockHeight + 15}
              className="fill-ink-3 font-mono text-[10px]"
            >
              {row.via}
            </text>
            {row.opened.map((line, index) => (
              <text
                key={line}
                x={604}
                y={center - (row.opened.length - 1) * 7.5 + 4 + index * 15}
                className="fill-ink-2 text-[12px]"
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

type TreeNode = {
  id: string;
  x: number;
  y: number;
  label: string;
  leaf?: boolean;
  role?: "target" | "proof" | "path" | "consistency";
};

export function MerkleDiagram() {
  const id = "merkle";
  const leafY = 250;
  const leaves = Array.from({ length: 7 }, (_, index) => 66 + index * 104.7);
  const mid = (a: number, b: number) => (a + b) / 2;
  const at = (index: number) => leaves[index] ?? 0;
  const n01 = mid(at(0), at(1));
  const n23 = mid(at(2), at(3));
  const n45 = mid(at(4), at(5));
  const n03 = mid(n01, n23);
  const n46 = mid(n45, at(6));
  const root = mid(n03, n46);
  const nodes: TreeNode[] = [
    ...leaves.map((x, index) => ({
      id: `d${index}`,
      x,
      y: leafY,
      label: `d${index}`,
      leaf: true,
      role:
        index === 5
          ? ("target" as const)
          : index === 4 || index === 6
            ? ("proof" as const)
            : undefined,
    })),
    { id: "n01", x: n01, y: 180, label: "h01" },
    { id: "n23", x: n23, y: 180, label: "h23" },
    { id: "n45", x: n45, y: 180, label: "h45", role: "path" },
    { id: "n03", x: n03, y: 112, label: "h0–3", role: "proof" },
    { id: "n46", x: n46, y: 112, label: "h4–6", role: "consistency" },
    { id: "root", x: root, y: 44, label: "root", role: "path" },
  ];
  const links: [string, string][] = [
    ["d0", "n01"],
    ["d1", "n01"],
    ["d2", "n23"],
    ["d3", "n23"],
    ["d4", "n45"],
    ["d5", "n45"],
    ["n01", "n03"],
    ["n23", "n03"],
    ["n45", "n46"],
    ["d6", "n46"],
    ["n03", "root"],
    ["n46", "root"],
  ];
  const onPath = new Set(["d5>n45", "n45>n46", "n46>root"]);
  const find = (key: string) => nodes.find((node) => node.id === key);
  return (
    <svg
      viewBox="0 0 760 300"
      className="h-auto w-full"
      role="img"
      aria-label="A Merkle tree of seven log entries. The inclusion proof for entry 5 is the hashes of entry 4, entry 6 and the subtree of entries 0 to 3. The consistency proof from size 4 to size 7 is the hash of the subtree of entries 4 to 6."
      fill="none"
    >
      <Arrowheads id={id} />
      <rect
        x={20}
        y={66}
        width={n23 - 20 + 90}
        height={212}
        rx={12}
        className="stroke-ink-3/60"
        strokeDasharray="4 5"
      />
      <text x={32} y={84} className="fill-ink-3 text-[11px]">
        tree at size 4
      </text>
      {links.map(([from, to]) => {
        const a = find(from);
        const b = find(to);
        if (!a || !b) return null;
        const active = onPath.has(`${from}>${to}`);
        return (
          <line
            key={`${from}-${to}`}
            x1={a.x}
            y1={a.y - (a.leaf ? 16 : 13)}
            x2={b.x}
            y2={b.y + 13}
            className={active ? "stroke-seal" : "stroke-ink-3"}
            strokeWidth={active ? 2 : 1.25}
          />
        );
      })}
      {nodes.map((node) => {
        const fill =
          node.role === "target"
            ? "fill-seal stroke-seal"
            : node.role === "proof"
              ? "fill-seal-soft stroke-seal"
              : node.role === "consistency"
                ? "fill-info-soft stroke-info"
                : node.role === "path"
                  ? "fill-bg stroke-seal"
                  : "fill-bg stroke-ink-3/40";
        const text =
          node.role === "target"
            ? "fill-on-seal"
            : node.role === "proof"
              ? "fill-seal-ink"
              : node.role === "consistency"
                ? "fill-info"
                : "fill-ink";
        return (
          <g key={node.id}>
            {node.leaf ? (
              <rect
                x={node.x - 22}
                y={node.y - 16}
                width={44}
                height={32}
                rx={6}
                className={fill}
              />
            ) : (
              <rect
                x={node.x - 30}
                y={node.y - 13}
                width={60}
                height={26}
                rx={13}
                className={fill}
              />
            )}
            <text
              x={node.x}
              y={node.y + 4}
              textAnchor="middle"
              className={cn("font-mono text-[11.5px] font-medium", text)}
            >
              {node.label}
            </text>
          </g>
        );
      })}
      <text x={at(4)} y={leafY + 32} textAnchor="middle" className="fill-seal-ink text-[11px]">
        proof 1
      </text>
      <text x={at(5)} y={leafY + 32} textAnchor="middle" className="fill-seal-ink text-[11px]">
        entry 5
      </text>
      <text x={at(6)} y={leafY + 32} textAnchor="middle" className="fill-seal-ink text-[11px]">
        proof 2
      </text>
      <text x={n03} y={112 - 20} textAnchor="middle" className="fill-seal-ink text-[11px]">
        proof 3
      </text>
      <text x={n46} y={92} textAnchor="middle" className="fill-info text-[11px]">
        consistency 4 → 7
      </text>
    </svg>
  );
}

export function JobStateDiagram() {
  const id = "jobs";
  const states = [
    { key: "queued", x: 20, y: 96, w: 128 },
    { key: "leased", x: 212, y: 96, w: 128 },
    { key: "running", x: 404, y: 96, w: 128 },
    { key: "succeeded", x: 612, y: 96, w: 128 },
    { key: "dead", x: 612, y: 212, w: 128 },
  ];
  return (
    <svg
      viewBox="0 0 760 290"
      className="h-auto w-full"
      role="img"
      aria-label="Job states. Queued jobs are claimed into leased, then running, then succeeded. A retryable failure under three attempts returns the job to queued. An expired lease returns it to queued. A final failure or the third attempt moves it to dead, and an admin retry returns a dead job to queued."
      fill="none"
    >
      <Arrowheads id={id} />
      {states.map((state) => (
        <g key={state.key}>
          <rect
            x={state.x}
            y={state.y}
            width={state.w}
            height={44}
            rx={22}
            className={cn(
              state.key === "succeeded"
                ? "fill-documented-soft stroke-documented"
                : state.key === "dead"
                  ? "fill-contradicted-soft stroke-contradicted"
                  : "fill-bg stroke-ink-3/40",
            )}
          />
          <text
            x={state.x + state.w / 2}
            y={state.y + (state.key === "leased" ? 21 : 27)}
            textAnchor="middle"
            className={cn(
              "font-mono text-[13px] font-medium",
              state.key === "succeeded"
                ? "fill-documented"
                : state.key === "dead"
                  ? "fill-contradicted"
                  : "fill-ink",
            )}
          >
            {state.key}
          </text>
          {state.key === "leased" ? (
            <text
              x={state.x + state.w / 2}
              y={state.y + 35}
              textAnchor="middle"
              className="fill-ink-3 font-mono text-[10px]"
            >
              10-min lease
            </text>
          ) : null}
        </g>
      ))}
      <path d="M148 118H208" className="stroke-ink-2" markerEnd={`url(#${id}-a)`} />
      <Label x={180} y={110}>
        claim
      </Label>
      <path d="M340 118H400" className="stroke-ink-2" markerEnd={`url(#${id}-a)`} />
      <Label x={372} y={110}>
        events
      </Label>
      <path
        d="M532 118H608"
        className="stroke-seal"
        strokeWidth={1.5}
        markerEnd={`url(#${id}-s)`}
      />
      <Label x={570} y={110}>
        complete
      </Label>
      <path
        d="M468 96C468 40 84 40 84 92"
        className="stroke-ink-2"
        strokeDasharray="5 4"
        markerEnd={`url(#${id}-a)`}
      />
      <Label x={276} y={46}>
        fail, retryable, attempts below 3
      </Label>
      <path
        d="M244 140C244 178 108 178 92 144"
        className="stroke-ink-2"
        strokeDasharray="5 4"
        markerEnd={`url(#${id}-a)`}
      />
      <Label x={168} y={188}>
        lease expired
      </Label>
      <path
        d="M496 140C496 210 560 234 608 234"
        className="stroke-ink-2"
        markerEnd={`url(#${id}-a)`}
      />
      <Label x={500} y={200} anchor="end">
        third attempt fails,
      </Label>
      <Label x={500} y={214} anchor="end">
        or not retryable
      </Label>
      <path
        d="M676 256C676 286 56 286 56 144"
        className="stroke-ink-2"
        strokeDasharray="2 4"
        markerEnd={`url(#${id}-a)`}
      />
      <Label x={380} y={276}>
        admin retry (dead-letter queue)
      </Label>
    </svg>
  );
}
