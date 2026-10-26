import { CircleCheck, CircleDashed, CircleX } from "lucide-react";

import { Spinner } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import type { Check } from "./checks";

export function CheckStatus({ check, className }: { check: Check; className?: string }) {
  if (check.status === "running")
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-sm text-ink-2", className)}>
        <Spinner className="size-3.5" />
        Checking
      </span>
    );
  if (check.status === "pass")
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-sm text-documented", className)}>
        <CircleCheck className="size-3.5" aria-hidden="true" />
        Passed
      </span>
    );
  if (check.status === "fail")
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-sm text-contradicted", className)}>
        <CircleX className="size-3.5" aria-hidden="true" />
        Failed
      </span>
    );
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-ink-3", className)}>
      <CircleDashed className="size-3.5" aria-hidden="true" />
      Not run
    </span>
  );
}
