import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

const controlBase =
  "w-full rounded-md border border-line-strong bg-bg px-3 text-base text-ink transition-colors duration-150 placeholder:text-ink-3 hover:border-ink-3 focus-visible:border-seal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seal/25 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-contradicted";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(controlBase, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(controlBase, "min-h-28 resize-y py-2 leading-6", className)}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-contradicted" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-ink-2">{hint}</p>
      ) : null}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line-strong bg-surface px-1 font-mono text-2xs text-ink-2">
      {children}
    </kbd>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-md bg-surface-2", className)} aria-hidden="true" />
  );
}
