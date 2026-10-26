import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/cn";

import { MobileNav } from "./mobile-nav";

export const siteLinks = [
  { href: "/architecture", label: "How it works" },
  { href: "/evals", label: "Evaluation" },
  { href: "/audit", label: "Transparency log" },
  { href: "/console", label: "Reviewer console" },
  { href: "/inbox", label: "Check replies" },
];

export function SiteHeader({ className }: { className?: string }) {
  return (
    <header
      className={cn(
        "relative z-20 mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-6 px-5 sm:px-8",
        className,
      )}
    >
      <Logo />
      <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
        {siteLinks.slice(0, 4).map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-md px-3 py-1.5 text-base whitespace-nowrap text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Link
          href="/inbox"
          className="hidden rounded-md px-3 py-1.5 text-base whitespace-nowrap text-ink-2 hover:bg-surface-2 hover:text-ink lg:inline-flex"
        >
          Check replies
        </Link>
        <MobileNav links={siteLinks} />
      </div>
    </header>
  );
}
