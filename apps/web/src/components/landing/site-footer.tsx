import Link from "next/link";

import { SealMark } from "@/components/brand/logo";

const links = [
  { href: "/report/northwind-ethics", label: "Make a report" },
  { href: "/inbox", label: "Check replies" },
  { href: "/console", label: "Reviewer console" },
  { href: "/architecture", label: "How it works" },
  { href: "/evals", label: "Evaluation" },
  { href: "/audit", label: "Transparency log" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid w-full max-w-[1200px] gap-10 px-5 py-12 sm:px-8 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex max-w-[60ch] flex-col gap-3">
          <p className="inline-flex items-center gap-2 text-md font-semibold">
            <SealMark className="size-5" />
            Candor
          </p>
          <p className="text-sm text-ink-2">Built for the Meta Global AI Developer Hackathon.</p>
          <p className="text-sm text-ink-2">
            Built with Meta Muse Spark via the Meta Model API, Self, Modal, x402, Baseten and
            Fireworks.
          </p>
          <p className="text-sm text-ink-3">
            Every person and organisation in the demos is fictional.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="rounded-xs text-ink-2 transition-colors duration-150 hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
