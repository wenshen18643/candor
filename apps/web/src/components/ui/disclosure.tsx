import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Disclosure({
  summary,
  children,
  className,
  bodyClassName,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
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
      <div className={cn("border-t border-line px-4 py-4", bodyClassName)}>{children}</div>
    </details>
  );
}
