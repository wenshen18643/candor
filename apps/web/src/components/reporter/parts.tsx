import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export { Disclosure } from "@/components/ui/disclosure";

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
