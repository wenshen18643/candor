import Link from "next/link";

import { cn } from "@/lib/cn";

export function SealMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="var(--seal)" />
      <circle cx="12" cy="12" r="7.25" fill="none" stroke="var(--on-seal)" strokeOpacity="0.35" />
      <rect x="7" y="10.75" width="10" height="2.5" rx="1.25" fill="var(--on-seal)" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center gap-2 rounded-sm text-ink", className)}
      aria-label="Candor home"
    >
      <SealMark />
      <span className="text-lg leading-none font-semibold tracking-[-0.015em]">Candor</span>
    </Link>
  );
}
