"use client";

import { FileStack, FlaskConical, KeyRound, LogOut, ScrollText, Workflow } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useConsole } from "@/lib/console/store";
import type { ReviewerIdentity } from "@/lib/console/types";

const nav = [
  { href: "/console", label: "Reports", icon: FileStack, exact: true },
  { href: "/audit", label: "Transparency log", icon: ScrollText },
  { href: "/evals", label: "Evaluation", icon: FlaskConical },
  { href: "/architecture", label: "Architecture", icon: Workflow },
];

const roleLabel: Record<string, string> = {
  admin: "Administrator",
  reviewer: "Reviewer",
  auditor: "Auditor",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

function SignIn() {
  const { client, setIdentity } = useConsole();
  const [identities, setIdentities] = useState<ReviewerIdentity[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .listIdentities()
      .then(setIdentities)
      .catch(() => setError("Could not load reviewer identities."));
  }, [client]);

  async function signIn(identity: ReviewerIdentity) {
    setBusy(identity.reviewerId);
    setError(null);
    try {
      await client.signIn(identity);
      setIdentity(identity);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-[520px] flex-col justify-center px-5 py-12">
      <h1 className="text-2xl font-semibold tracking-[-0.01em]">Reviewer sign-in</h1>
      <p className="mt-2 text-base text-ink-2">
        No passwords. Pick a demo reviewer to sign in with their key.
      </p>
      <ul className="mt-6 flex flex-col gap-2">
        {identities.map((identity) => (
          <li key={identity.reviewerId}>
            <button
              type="button"
              onClick={() => signIn(identity)}
              disabled={busy !== null}
              className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-line p-3 text-left transition-colors duration-150 hover:border-line-strong hover:bg-surface disabled:cursor-wait"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-ink-2">
                {initials(identity.displayName)}
              </span>
              <span className="flex-1">
                <span className="block text-base font-medium">{identity.displayName}</span>
                <span className="text-sm text-ink-2">{roleLabel[identity.role]}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm text-ink-3">
                <KeyRound className="size-3.5" aria-hidden="true" />
                {busy === identity.reviewerId ? "Signing challenge…" : "Sign challenge"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-contradicted">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { identity, setIdentity, client, hydrated } = useConsole();
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    void useConsole.persist.rehydrate();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const remembered = useConsole.getState().identity;
    if (!remembered) {
      setRestored(true);
      return;
    }
    let cancelled = false;
    client
      .signIn(remembered)
      .catch(() => {
        if (!cancelled) setIdentity(null);
      })
      .finally(() => {
        if (!cancelled) setRestored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, client, setIdentity]);

  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 lg:sticky lg:top-0 lg:h-dvh lg:flex-col lg:items-stretch lg:justify-start lg:border-r lg:border-b-0 lg:px-3 lg:py-4">
          <div className="flex items-center gap-2 lg:flex-col lg:items-start lg:px-2">
            <Logo href="/" />
            <span className="hidden text-sm text-ink-2 lg:block">
              Northwind Health · Ethics office
            </span>
          </div>
          <nav aria-label="Console" className="hidden lg:mt-6 lg:flex lg:flex-col lg:gap-0.5">
            {nav.map((item) => {
              const active = item.exact
                ? pathname === item.href || pathname.startsWith("/console/reports")
                : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-base transition-colors duration-150",
                    active
                      ? "bg-surface-3 font-medium text-ink"
                      : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2 lg:mt-auto lg:flex-col lg:items-stretch lg:gap-3">
            {client.mode === "showcase" ? (
              <Badge
                tone="outline"
                className="hidden self-start lg:inline-flex"
                title="No backend configured; using recorded data."
              >
                Showcase data
              </Badge>
            ) : null}
            {identity ? (
              <div className="flex items-center gap-2 lg:rounded-lg lg:border lg:border-line lg:bg-bg lg:p-2">
                <span className="flex size-8 items-center justify-center rounded-full bg-seal-soft text-xs font-semibold text-seal-ink">
                  {initials(identity.displayName)}
                </span>
                <span className="hidden min-w-0 flex-1 lg:block">
                  <span className="block truncate text-sm font-medium">{identity.displayName}</span>
                  <span className="text-xs text-ink-2">{roleLabel[identity.role]}</span>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIdentity(null)}
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut aria-hidden="true" />
                </Button>
              </div>
            ) : null}
            <ThemeToggle className="lg:self-start" />
          </div>
        </aside>
        <main className="min-w-0">
          {!hydrated || !restored ? null : identity ? children : <SignIn />}
        </main>
      </div>
    </TooltipProvider>
  );
}
