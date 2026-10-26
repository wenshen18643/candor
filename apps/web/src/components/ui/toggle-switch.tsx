"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function ToggleSwitch({
  checked,
  onCheckedChange,
  label,
  description,
  tone = "seal",
  className,
  id,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  tone?: "seal" | "contradicted" | "allegation";
  className?: string;
  id: string;
}) {
  const track =
    tone === "contradicted"
      ? "bg-contradicted"
      : tone === "allegation"
        ? "bg-allegation"
        : "bg-seal";
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-description` : undefined}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150",
          checked ? track : "bg-line-strong",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "shadow-pop block size-4 rounded-full bg-bg transition-transform duration-200 ease-[var(--ease-out-quart)]",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-ink">
          {label}
        </label>
        {description ? (
          <p id={`${id}-description`} className="text-sm text-ink-2">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
