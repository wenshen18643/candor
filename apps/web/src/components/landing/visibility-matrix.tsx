import {
  Eye,
  EyeOff,
  FileLock,
  Globe,
  Hash,
  Lock,
  type LucideIcon,
  MemoryStick,
  ScrollText,
  ShieldCheck,
  Ticket,
  UsersRound,
} from "lucide-react";

import { cn } from "@/lib/cn";

type Access =
  | "sees"
  | "never"
  | "quorum"
  | "cipher"
  | "hashes"
  | "proof"
  | "token"
  | "public"
  | "appends"
  | "memory"
  | "writes";

const accessMeta: Record<
  Access,
  { label: string; icon: LucideIcon; plaintext: boolean; tone: string }
> = {
  sees: { label: "Sees", icon: Eye, plaintext: true, tone: "text-ink" },
  memory: { label: "In memory", icon: MemoryStick, plaintext: true, tone: "text-ink" },
  writes: { label: "Writes, then seals", icon: FileLock, plaintext: true, tone: "text-ink" },
  never: { label: "Never", icon: EyeOff, plaintext: false, tone: "text-ink-2" },
  quorum: { label: "Only with quorum", icon: UsersRound, plaintext: false, tone: "text-seal-ink" },
  cipher: { label: "Ciphertext only", icon: Lock, plaintext: false, tone: "text-ink-2" },
  hashes: { label: "Hashes only", icon: Hash, plaintext: false, tone: "text-ink-2" },
  proof: { label: "Proof only", icon: ShieldCheck, plaintext: false, tone: "text-ink-2" },
  token: { label: "Blind token", icon: Ticket, plaintext: false, tone: "text-ink-2" },
  public: { label: "Public entries", icon: Globe, plaintext: false, tone: "text-ink-2" },
  appends: { label: "Appends", icon: ScrollText, plaintext: false, tone: "text-ink-2" },
};

const columns = [
  { key: "identity", label: "Your identity" },
  { key: "originals", label: "Original files" },
  { key: "names", label: "Real names in evidence" },
  { key: "redacted", label: "Redacted text" },
  { key: "findings", label: "Analysis findings" },
  { key: "history", label: "Access history" },
] as const;

type ColumnKey = (typeof columns)[number]["key"];
type Cell = { access: Access; note?: string };

const rows: { party: string; detail: string; cells: Record<ColumnKey, Cell> }[] = [
  {
    party: "Your device",
    detail: "Browser and the Self app",
    cells: {
      identity: { access: "sees", note: "Passport stays in the Self app" },
      originals: { access: "sees" },
      names: { access: "sees" },
      redacted: { access: "sees", note: "You approve the diff" },
      findings: { access: "never" },
      history: { access: "public" },
    },
  },
  {
    party: "Identity service",
    detail: "Verifies proofs, signs blind tokens",
    cells: {
      identity: { access: "proof", note: "Over 18, one tag per campaign" },
      originals: { access: "never" },
      names: { access: "never" },
      redacted: { access: "never" },
      findings: { access: "never" },
      history: { access: "public" },
    },
  },
  {
    party: "Report API",
    detail: "Stores reports, runs the log",
    cells: {
      identity: { access: "token", note: "Unlinkable to the verification" },
      originals: { access: "cipher" },
      names: { access: "cipher", note: "Name map is in the sealed manifest" },
      redacted: { access: "cipher", note: "Sealed to the worker" },
      findings: { access: "cipher", note: "Sealed to reviewers" },
      history: { access: "appends", note: "Signs every tree head" },
    },
  },
  {
    party: "Analysis worker",
    detail: "Runs the Muse model pipeline",
    cells: {
      identity: { access: "never" },
      originals: { access: "never" },
      names: { access: "never", note: "Holds no name map" },
      redacted: { access: "memory", note: "Sent to the model as prompts" },
      findings: { access: "writes", note: "One key per reviewer" },
      history: { access: "public" },
    },
  },
  {
    party: "One reviewer",
    detail: "Holds one key share",
    cells: {
      identity: { access: "never" },
      originals: { access: "quorum" },
      names: { access: "quorum", note: "Sees PERSON_1, not the name" },
      redacted: { access: "sees" },
      findings: { access: "sees" },
      history: { access: "public" },
    },
  },
  {
    party: "2-of-3 reviewer quorum",
    detail: "Two shares combined in a browser",
    cells: {
      identity: { access: "never" },
      originals: { access: "sees", note: "Opening is logged publicly" },
      names: { access: "sees", note: "Opening is logged publicly" },
      redacted: { access: "sees" },
      findings: { access: "sees" },
      history: { access: "public" },
    },
  },
  {
    party: "Anyone",
    detail: "Through the public transparency log",
    cells: {
      identity: { access: "never" },
      originals: { access: "hashes", note: "Merkle root of file hashes" },
      names: { access: "never" },
      redacted: { access: "never" },
      findings: { access: "hashes", note: "SHA-256 of the findings" },
      history: { access: "sees", note: "Types, IDs and times, no content" },
    },
  },
];

function CellValue({ cell }: { cell: Cell }) {
  const meta = accessMeta[cell.access];
  const Icon = meta.icon;
  return (
    <span className="flex flex-col gap-0.5">
      <span className={cn("inline-flex items-center gap-1.5 font-medium", meta.tone)}>
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {meta.label}
      </span>
      {cell.note ? <span className="text-xs text-ink-3">{cell.note}</span> : null}
    </span>
  );
}

export function VisibilityMatrix() {
  return (
    <section
      aria-labelledby="visibility-title"
      className="mx-auto w-full max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
        <h2 id="visibility-title" className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
          Who can see what
        </h2>
        <p className="max-w-[60ch] text-md text-ink-2">
          Every part of Candor gets the least it needs to do its job. This is the whole picture,
          cell by cell, as the system is built. Shaded cells are where something is readable in
          plain text.
        </p>
      </div>

      <div className="mt-10 hidden overflow-hidden rounded-xl border border-line lg:block">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <caption className="sr-only">
            Which parts of Candor can read each kind of data. Shaded cells mark plain-text access.
          </caption>
          <colgroup>
            <col className="w-[12.5rem]" />
            {columns.map((column) => (
              <col key={column.key} />
            ))}
          </colgroup>
          <thead className="bg-surface">
            <tr>
              <th scope="col" className="px-4 py-3 text-xs font-medium text-ink-2">
                Party
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className="px-3 py-3 align-bottom text-xs font-medium text-ink-2"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.party} className="border-t border-line">
                <th scope="row" className="px-4 py-3.5 align-top font-normal">
                  <span className="block font-semibold text-ink">{row.party}</span>
                  <span className="mt-0.5 block text-xs text-ink-3">{row.detail}</span>
                </th>
                {columns.map((column) => {
                  const cell = row.cells[column.key];
                  return (
                    <td
                      key={column.key}
                      className={cn(
                        "border-l border-line px-3 py-3.5 align-top",
                        accessMeta[cell.access].plaintext && "bg-surface-2",
                      )}
                    >
                      <CellValue cell={cell} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-10 divide-y divide-line overflow-hidden rounded-xl border border-line lg:hidden">
        {rows.map((row) => (
          <li key={row.party}>
            <div className="border-b border-line bg-surface px-4 py-3">
              <h3 className="text-md font-semibold">{row.party}</h3>
              <p className="text-xs text-ink-3">{row.detail}</p>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-3">
              {columns.map((column) => {
                const cell = row.cells[column.key];
                return (
                  <div
                    key={column.key}
                    className={cn(
                      "border-line px-4 py-3 text-sm max-sm:odd:border-r sm:[&:not(:nth-child(3n))]:border-r",
                      "border-b max-sm:[&:nth-last-child(-n+2)]:border-b-0 sm:[&:nth-last-child(-n+3)]:border-b-0",
                      accessMeta[cell.access].plaintext && "bg-surface-2",
                    )}
                  >
                    <dt className="text-xs text-ink-2">{column.label}</dt>
                    <dd className="mt-1">
                      <CellValue cell={cell} />
                    </dd>
                  </div>
                );
              })}
            </dl>
          </li>
        ))}
      </ul>

      <ul className="mt-8 grid gap-x-10 gap-y-3 text-sm text-ink-2 md:grid-cols-2">
        <li>
          <span className="font-medium text-ink">“Never” means Candor never sends it there.</span>{" "}
          It cannot stop someone recognising you from details inside the evidence, or from how you
          write.
        </li>
        <li>
          <span className="font-medium text-ink">
            Like any website, the report API sees the network address you connect from.
          </span>{" "}
          It is not stored with your report. If that matters, use Tor or a network your employer
          does not run.
        </li>
        <li>
          <span className="font-medium text-ink">The model sees redacted text only.</span> Prompts
          go to Meta Muse Spark through the Meta Model API, whose own retention policy applies.
        </li>
        <li>
          <span className="font-medium text-ink">Public entries carry no content.</span> Anyone can
          read entry types, report and reviewer IDs, hour buckets and hashes.
        </li>
      </ul>
    </section>
  );
}
