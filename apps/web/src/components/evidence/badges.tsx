import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleSlash,
  Layers,
  ShieldAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { confidenceLabel, evidenceClassMeta, verdictMeta } from "@/lib/evidence";
import type { Confidence, EvidenceClass, Verdict } from "@/lib/types";

const classIcon: Record<EvidenceClass, typeof CircleCheck> = {
  corroborated: Layers,
  documented: CircleCheck,
  single_source: CircleDashed,
  reporter_allegation: CircleHelp,
  contradicted: CircleAlert,
  unsupported: CircleSlash,
};

export function EvidenceClassBadge({
  value,
  className,
}: {
  value: EvidenceClass | null | undefined;
  className?: string;
}) {
  if (!value) return null;
  const meta = evidenceClassMeta[value];
  const Icon = classIcon[value];
  return (
    <Badge tone={meta.tone} className={className} title={meta.description}>
      <Icon aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}

export function VerdictBadge({ value }: { value: Verdict | null | undefined }) {
  if (!value) return null;
  const meta = verdictMeta[value];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function QuarantineBadge() {
  return (
    <Badge tone="quarantine" title="This passage tried to instruct the model and was quarantined.">
      <ShieldAlert aria-hidden="true" />
      Quarantined
    </Badge>
  );
}

export function ConfidenceMeter({
  confidence,
  showLabel = true,
  className,
}: {
  confidence: Confidence | null | undefined;
  showLabel?: boolean;
  className?: string;
}) {
  if (!confidence) return null;
  const score = Math.max(0, Math.min(1, confidence.score));
  const segments = 10;
  const filled = Math.round(score * segments);
  const tone =
    confidence.label === "high"
      ? "bg-documented"
      : confidence.label === "moderate"
        ? "bg-info"
        : confidence.label === "low"
          ? "bg-allegation"
          : "bg-unsupported";
  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      role="img"
      aria-label={`${confidenceLabel[confidence.label]}, ${Math.round(score * 100)} out of 100`}
      title={confidence.statement}
    >
      <span className="flex gap-[2px]" aria-hidden="true">
        {Array.from({ length: segments }, (_, index) => (
          <span
            key={index}
            className={cn("h-2.5 w-1 rounded-[1px]", index < filled ? tone : "bg-surface-3")}
          />
        ))}
      </span>
      {showLabel ? (
        <span className="tabular text-xs text-ink-2">{Math.round(score * 100)}</span>
      ) : null}
    </span>
  );
}
