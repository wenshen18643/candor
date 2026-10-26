import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Disclosure({
  summary,
  children,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("group rounded-lg border border-line", className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 text-base font-medium text-ink-2 transition-colors duration-150 hover:text-ink [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronDown
          className="size-4 shrink-0 text-ink-3 transition-transform duration-200 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-line px-4 py-4">{children}</div>
    </details>
  );
}

export function StepHeading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1
        tabIndex={-1}
        className="text-2xl font-semibold tracking-[-0.015em] text-balance outline-none sm:text-3xl"
      >
        {title}
      </h1>
      {children ? (
        <div className="mt-3 max-w-[62ch] text-md leading-7 text-pretty text-ink-2">{children}</div>
      ) : null}
    </div>
  );
}

export function StepActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "mt-10 flex flex-col-reverse gap-2 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-md font-semibold">{children}</h2>
      {aside}
    </div>
  );
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
