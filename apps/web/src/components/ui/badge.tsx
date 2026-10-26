import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex h-5 items-center gap-1 rounded-full px-2 text-2xs font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "bg-surface-2 text-ink-2",
        seal: "bg-seal-soft text-seal-ink",
        documented: "bg-documented-soft text-documented",
        allegation: "bg-allegation-soft text-allegation",
        unsupported: "bg-unsupported-soft text-unsupported",
        contradicted: "bg-contradicted-soft text-contradicted",
        info: "bg-info-soft text-info",
        quarantine: "bg-quarantine-soft text-quarantine",
        outline: "border border-line-strong text-ink-2",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({
  className,
  tone,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
