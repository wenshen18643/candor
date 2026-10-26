"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { truncateMiddle } from "@/lib/format";

export function Hash({
  value,
  head = 8,
  tail = 6,
  label,
  copyable = true,
  className,
}: {
  value: string;
  head?: number;
  tail?: number;
  label?: string;
  copyable?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  const text = (
    <span className="tabular font-mono text-xs tracking-tight text-ink-2" title={value}>
      {truncateMiddle(value, head, tail)}
    </span>
  );

  if (!copyable) return <span className={cn("inline-flex items-center", className)}>{text}</span>;

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "group -mx-1 inline-flex cursor-pointer items-center gap-1.5 rounded-xs px-1 hover:bg-surface-2",
        className,
      )}
      aria-label={`Copy ${label ?? "value"}`}
    >
      {text}
      {copied ? (
        <Check className="size-3 text-documented" aria-hidden="true" />
      ) : (
        <Copy className="size-3 text-ink-3 opacity-0 group-hover:opacity-100" aria-hidden="true" />
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}
