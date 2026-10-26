"use client";

import type { Detection, LeakageReport, PseudonymEntry, StrippedFile } from "@candor/privacy";
import { AlertTriangle, Check, FileText, Image as ImageIcon, ShieldCheck } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { metadataLabel, revealingFirst } from "@/lib/format";
import { applyRedactions, documentKey, hasText, statementKey } from "@/lib/reporter/engine";
import { type Action, useReporter } from "@/lib/reporter/store";

import { SectionTitle, StepActions, StepHeading } from "./parts";

const typeLabel: Record<string, string> = {
  person: "Person",
  org: "Organisation",
  place: "Place",
  email: "Email",
  phone: "Phone",
  id: "ID number",
  account: "Account",
  url: "Link",
  ip: "IP address",
  date_of_birth: "Birth date",
  other: "Detail",
  self: "About you",
};

const quasiLabel: Record<string, string> = {
  unique_role: "Describes your role",
  small_headcount: "Mentions a small group",
  team_role: "Names a role in a team",
  exact_timestamp: "Exact time",
  specific_location: "Specific place",
};

const nextAction: Record<Action, Action> = {
  pseudonymise: "redact",
  redact: "keep",
  keep: "pseudonymise",
};

const actionCopy: Record<Action, string> = {
  pseudonymise: "replaced with a code name",
  redact: "removed",
  keep: "kept as written",
};

function uniqueQuasi(report: LeakageReport) {
  const seen = new Set<string>();
  return report.quasiIdentifiers.filter((hit) => {
    const key = `${hit.kind}:${hit.text.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function quasiGroups(report: LeakageReport) {
  const groups = new Map<string, string[]>();
  for (const hit of uniqueQuasi(report))
    groups.set(hit.kind, [...(groups.get(hit.kind) ?? []), hit.text.trim()]);
  return [...groups].map(([kind, texts]) => ({ kind, texts }));
}

function placeholderFor(hit: Detection, map: PseudonymEntry[]) {
  const entry = map.find(
    (item) =>
      item.type === hit.type && (item.value === hit.text || item.variants.includes(hit.text)),
  );
  return entry?.placeholder ?? hit.type.toUpperCase();
}

function DocumentView({
  text,
  detections,
  decisions,
  map,
  onToggle,
}: {
  text: string;
  detections: Detection[];
  decisions: Record<string, Action>;
  map: PseudonymEntry[];
  onToggle: (hit: Detection) => void;
}) {
  const sorted = [...detections].sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const hit of sorted) {
    if (hit.start < cursor) continue;
    parts.push(text.slice(cursor, hit.start));
    const locked = hit.source === "self";
    const action: Action = locked ? "redact" : (decisions[hit.id] ?? "pseudonymise");
    parts.push(
      <button
        key={hit.id}
        type="button"
        disabled={locked}
        onClick={() => onToggle(hit)}
        aria-label={`${hit.text}, ${typeLabel[locked ? "self" : hit.type] ?? "detail"}, ${actionCopy[action]}.${locked ? " Always removed." : " Activate to change."}`}
        className={cn(
          "mx-px inline rounded px-0.5 py-px align-baseline transition-colors duration-150",
          locked && "cursor-not-allowed bg-ink text-bg",
          !locked && "cursor-pointer",
          !locked && action === "pseudonymise" && "bg-seal-soft text-seal-ink hover:bg-seal/20",
          !locked && action === "redact" && "bg-ink/85 text-bg hover:bg-ink",
          !locked &&
            action === "keep" &&
            "underline decoration-unsupported decoration-dotted decoration-2 underline-offset-4 hover:bg-surface-2",
        )}
      >
        {action === "pseudonymise" ? (
          <>
            <span className="line-through decoration-seal-ink/50">{hit.text}</span>
            <span className="ml-1 font-mono text-[0.78em] font-semibold">
              {placeholderFor(hit, map)}
            </span>
          </>
        ) : action === "redact" ? (
          <span className="font-mono text-[0.78em] tracking-wide">REDACTED</span>
        ) : (
          hit.text
        )}
      </button>,
    );
    cursor = hit.end;
  }
  parts.push(text.slice(cursor));
  return (
    <div className="max-h-[440px] overflow-auto px-4 py-4 text-base leading-8 whitespace-pre-wrap">
      {parts}
    </div>
  );
}

function RiskMeter({ leakage }: { leakage: LeakageReport | null }) {
  const level = leakage?.level ?? "low";
  const tone = {
    low: { label: "Low", bar: "bg-documented", text: "text-documented" },
    elevated: { label: "Medium", bar: "bg-allegation", text: "text-allegation" },
    high: { label: "High", bar: "bg-contradicted", text: "text-contradicted" },
  }[level];
  const selfLeft = leakage?.residual.filter((hit) => hit.type === "self") ?? [];
  const otherLeft = leakage?.residual.filter((hit) => hit.type !== "self") ?? [];
  return (
    <div className="rounded-lg border border-line p-4" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-md font-semibold">Chance this points to you</h2>
        <span className={cn("text-md font-semibold", tone.text)}>
          {leakage ? tone.label : "Checking…"}
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500 ease-out", tone.bar)}
          style={{ width: `${Math.max(4, leakage?.score ?? 0)}%` }}
        />
      </div>
      <ul className="mt-4 flex flex-col gap-2 text-base leading-6">
        {selfLeft.length === 0 ? (
          <li className="flex gap-2 text-ink-2">
            <Check className="mt-1 size-4 shrink-0 text-documented" aria-hidden="true" />
            None of your own details are left.
          </li>
        ) : (
          <li className="flex gap-2 text-contradicted">
            <AlertTriangle className="mt-1 size-4 shrink-0" aria-hidden="true" />
            {selfLeft.length} word{selfLeft.length === 1 ? "" : "s"} about you still appear.
          </li>
        )}
        {otherLeft.length ? (
          <li className="flex gap-2 text-ink-2">
            <AlertTriangle className="mt-1 size-4 shrink-0 text-allegation" aria-hidden="true" />
            You chose to keep {otherLeft.length} name or detail
            {otherLeft.length === 1 ? "" : "s"} as written.
          </li>
        ) : null}
        {leakage?.quasiIdentifiers.length ? (
          <li className="text-ink-2">
            <span className="flex gap-2">
              <AlertTriangle className="mt-1 size-4 shrink-0 text-allegation" aria-hidden="true" />
              These could narrow it down to you. Consider rewording:
            </span>
            <ul className="mt-2 ml-6 flex flex-col gap-1">
              {quasiGroups(leakage).map((group) => (
                <li key={group.kind} className="text-sm">
                  <span className="text-ink-3">
                    {quasiLabel[group.kind] ?? "Detail"}
                    {group.texts.length > 1 ? ` (${group.texts.length})` : ""}:
                  </span>{" "}
                  <q className="text-ink">{group.texts[0]}</q>
                  {group.texts.length > 1 ? <span className="text-ink-3"> and others</span> : null}
                </li>
              ))}
            </ul>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function FileCard({
  file,
  variant,
  onVariant,
}: {
  file: StrippedFile;
  variant: "original" | "redacted";
  onVariant: (value: "original" | "redacted") => void;
}) {
  const textual = hasText(file);
  const Icon = file.kind === "image" ? ImageIcon : FileText;
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium">{file.name}</p>
          {file.metadataRemoved.length ? (
            <p className="mt-0.5 text-sm text-ink-2">
              Removed:{" "}
              {revealingFirst(file.metadataRemoved)
                .slice(0, 4)
                .map((field) => metadataLabel(field.field))
                .join(", ")}
              {file.metadataRemoved.length > 4
                ? ` and ${file.metadataRemoved.length - 4} more`
                : ""}
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-ink-3">No hidden details found.</p>
          )}
        </div>
        {file.metadataRemoved.length ? (
          <Badge tone="documented">
            <ShieldCheck aria-hidden="true" />
            {file.metadataRemoved.length} removed
          </Badge>
        ) : null}
      </div>
      {textual ? (
        <fieldset className="mt-3 ml-7">
          <legend className="sr-only">Send {file.name} as</legend>
          <div className="inline-flex rounded-md border border-line-strong p-0.5">
            {(["redacted", "original"] as const).map((value) => (
              <label
                key={value}
                className={cn(
                  "cursor-pointer rounded px-2.5 py-1 text-sm transition-colors duration-150 has-focus-visible:ring-2 has-focus-visible:ring-seal/40",
                  variant === value
                    ? "bg-surface-3 font-medium text-ink"
                    : "text-ink-2 hover:text-ink",
                )}
              >
                <input
                  type="radio"
                  name={`variant-${file.sha256}`}
                  value={value}
                  checked={variant === value}
                  onChange={() => onVariant(value)}
                  className="sr-only"
                />
                {value === "redacted" ? "Send hidden-name text" : "Send cleaned original"}
              </label>
            ))}
          </div>
          {variant === "original" ? (
            <p className="mt-2 text-sm text-allegation">
              This keeps the names you hid. Only pick it if the file itself matters, like a signed
              scan.
            </p>
          ) : null}
        </fieldset>
      ) : null}
    </li>
  );
}

export function StepReview() {
  const {
    files,
    docs,
    detections,
    decisions,
    variants,
    selfTerms,
    scrubbed,
    leakage,
    patch,
    setDecision,
    setStep,
  } = useReporter();
  const [active, setActive] = useState(statementKey);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const list = Object.entries(decisions).map(([detectionId, action]) => ({
      detectionId,
      action,
    }));
    applyRedactions(docs, detections, list, selfTerms)
      .then(({ result, leakage: report }) => {
        if (current) patch({ scrubbed: result, leakage: report });
      })
      .catch(() => {
        if (current) setError("Couldn't apply your choices. Try again.");
      });
    return () => {
      current = false;
    };
  }, [docs, detections, decisions, selfTerms, patch]);

  const tabs = useMemo(
    () =>
      docs.map((doc) => {
        const index = files.findIndex((_, position) => documentKey(position) === doc.docKey);
        return {
          key: doc.docKey,
          label:
            doc.docKey === statementKey ? "Your statement" : (files[index]?.name ?? doc.docKey),
          count: detections.filter((hit) => hit.docKey === doc.docKey).length,
        };
      }),
    [docs, files, detections],
  );

  const doc = docs.find((item) => item.docKey === active) ?? docs[0];
  const map = scrubbed?.pseudonymMap ?? [];

  function toggle(hit: Detection) {
    setDecision(hit.id, nextAction[decisions[hit.id] ?? "pseudonymise"]);
  }

  return (
    <section>
      <StepHeading title="Check what will be sent">
        <p>
          Names became code names like{" "}
          <span className="rounded bg-seal-soft px-1 font-mono text-sm font-semibold text-seal-ink">
            PERSON_1
          </span>
          . Tap one to remove it or keep it.
        </p>
      </StepHeading>

      <RiskMeter leakage={leakage} />

      <div className="mt-8">
        <SectionTitle aside={<span className="text-sm text-ink-3">{detections.length} found</span>}>
          Text
        </SectionTitle>
        <div className="overflow-hidden rounded-lg border border-line">
          <div
            role="group"
            aria-label="Choose a document"
            className="scroll-strip flex gap-1 overflow-x-auto border-b border-line bg-surface p-1.5 pr-8"
          >
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-pressed={tab.key === doc?.docKey}
                onClick={() => setActive(tab.key)}
                className={cn(
                  "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors duration-150",
                  tab.key === doc?.docKey
                    ? "bg-bg font-medium text-ink shadow-[0_0_0_1px_var(--color-line-strong)]"
                    : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                )}
              >
                <span className="max-w-[180px] truncate">{tab.label}</span>
                {tab.count ? <span className="text-ink-3 tabular-nums">{tab.count}</span> : null}
              </button>
            ))}
          </div>
          {doc ? (
            <div>
              <DocumentView
                text={doc.text}
                detections={detections.filter((hit) => hit.docKey === doc.docKey)}
                decisions={decisions}
                map={map}
                onToggle={toggle}
              />
            </div>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2">
          <span className="flex items-center gap-1.5">
            <span className="rounded bg-seal-soft px-1 font-mono text-2xs font-semibold text-seal-ink">
              ORG_1
            </span>
            Code name
          </span>
          <span className="flex items-center gap-1.5">
            <span className="rounded bg-ink/85 px-1 font-mono text-2xs text-bg">REDACTED</span>
            Removed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="underline decoration-unsupported decoration-dotted decoration-2 underline-offset-4">
              Name
            </span>
            Kept
          </span>
        </div>
      </div>

      {map.length ? (
        <div className="mt-8">
          <SectionTitle>Code names</SectionTitle>
          <p className="mb-3 text-base leading-6 text-ink-2">
            Locked with your files. The AI only sees the code names.
          </p>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {map.map((entry) => (
              <li key={entry.placeholder} className="flex items-baseline gap-2 text-base">
                <span className="font-mono text-sm font-semibold text-seal-ink">
                  {entry.placeholder}
                </span>
                <span className="truncate text-ink-2">{entry.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {files.length ? (
        <div className="mt-8">
          <SectionTitle>Files</SectionTitle>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {files.map((file, index) => (
              <FileCard
                key={`${file.sha256}-${index}`}
                file={file}
                variant={variants[index] ?? "redacted"}
                onVariant={(value) =>
                  patch({
                    variants: variants.map((item, position) => (position === index ? value : item)),
                  })
                }
              />
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-6 text-sm text-contradicted">
          {error}
        </p>
      ) : null}

      <StepActions>
        <Button variant="ghost" onClick={() => setStep("evidence")}>
          Back
        </Button>
        <Button variant="primary" size="lg" disabled={!scrubbed} onClick={() => setStep("seal")}>
          Looks right
        </Button>
      </StepActions>
    </section>
  );
}
