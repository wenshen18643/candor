"use client";

import { LogOut } from "lucide-react";
import { MotionConfig } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/field";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/cn";
import { loadCampaign } from "@/lib/reporter/engine";
import { type StepId, useReporter } from "@/lib/reporter/store";

import { StepEvidence } from "./step-evidence";
import { StepIntro } from "./step-intro";
import { StepReceipt } from "./step-receipt";
import { StepReview } from "./step-review";
import { StepSeal } from "./step-seal";
import { StepVerify } from "./step-verify";

const progressSteps: { id: StepId; label: string }[] = [
  { id: "verify", label: "Verify" },
  { id: "evidence", label: "Evidence" },
  { id: "review", label: "Review" },
  { id: "seal", label: "Seal" },
];

function leaveQuickly() {
  window.location.replace("https://www.bbc.com/weather");
}

function Progress({ step }: { step: StepId }) {
  const index = progressSteps.findIndex((item) => item.id === step);
  if (index < 0) return null;
  const current = progressSteps[index];
  return (
    <div className="mb-8">
      <p className="mb-2 text-sm text-ink-2">
        Step {index + 1} of {progressSteps.length}
        <span className="text-ink-3"> · </span>
        <span className="font-medium text-ink">{current?.label}</span>
      </p>
      <ol className="grid grid-cols-4 gap-1.5" aria-hidden="true">
        {progressSteps.map((item, position) => (
          <li
            key={item.id}
            className={cn(
              "h-1 rounded-full transition-colors duration-300",
              position <= index ? "bg-seal" : "bg-surface-3",
            )}
          />
        ))}
      </ol>
    </div>
  );
}

export function ReporterFlow({ campaignId }: { campaignId: string }) {
  const step = useReporter((state) => state.step);
  const campaign = useReporter((state) => state.campaign);
  const patch = useReporter((state) => state.patch);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    loadCampaign(campaignId)
      .then((value) => {
        if (active) patch({ campaign: value });
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "This reporting channel is unavailable.",
          );
      });
    return () => {
      active = false;
    };
  }, [campaignId, patch]);

  useEffect(() => {
    headingRef.current?.querySelector("h1")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [step]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh bg-bg">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-[720px] items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Logo />
              {campaign ? (
                <span className="hidden truncate text-sm text-ink-2 sm:block">
                  {campaign.orgName} · {campaign.title}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              {campaign?.mode === "showcase" ? (
                <Badge
                  tone="outline"
                  className="hidden sm:inline-flex"
                  title="No backend is configured. Cryptography runs for real in your browser, but nothing is sent."
                >
                  Demo mode
                </Badge>
              ) : null}
              <ThemeToggle />
              <Button variant="secondary" size="sm" onClick={leaveQuickly}>
                <LogOut aria-hidden="true" />
                Leave quickly
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[720px] px-4 pt-8 pb-24 sm:px-6 sm:pt-12">
          {error ? (
            <div role="alert" className="rounded-lg border border-line p-5">
              <h1 className="text-xl font-semibold">This reporting channel is unavailable</h1>
              <p className="mt-2 text-base text-ink-2">{error}</p>
            </div>
          ) : !campaign ? (
            <div className="flex flex-col gap-4" aria-busy="true">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-5/6" />
              <Skeleton className="mt-6 h-40 w-full" />
            </div>
          ) : (
            <>
              <Progress step={step} />
              <div
                key={step}
                ref={headingRef}
                className="motion-safe:animate-[step-in_320ms_cubic-bezier(0.22,1,0.36,1)]"
              >
                {step === "intro" ? <StepIntro campaign={campaign} /> : null}
                {step === "verify" ? <StepVerify campaign={campaign} /> : null}
                {step === "evidence" ? <StepEvidence /> : null}
                {step === "review" ? <StepReview /> : null}
                {step === "seal" ? <StepSeal campaign={campaign} /> : null}
                {step === "receipt" ? <StepReceipt /> : null}
              </div>
            </>
          )}
        </main>
      </div>
    </MotionConfig>
  );
}
