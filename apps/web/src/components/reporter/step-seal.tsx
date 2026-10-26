"use client";

import { Check, Lock } from "lucide-react";
import { useState } from "react";

import { Button, Spinner } from "@/components/ui/button";
import { Hash } from "@/components/ui/hash";
import { cn } from "@/lib/cn";
import { sealAndSubmit } from "@/lib/reporter/engine";
import { useReporter } from "@/lib/reporter/store";
import type { CampaignInfo } from "@/lib/reporter/types";

import { StepActions, StepHeading } from "./parts";

const plannedSteps = [
  "Generate the report key",
  "Commit to your evidence",
  "Encrypt files and manifest",
  "Split the key between reviewers",
  "Seal the hidden-name text for analysis",
  "Create your private inbox",
  "Wait a random delay",
  "Send with one unlinkable token",
];

function isHex(value: string) {
  return /^[0-9a-f]{32,}$/.test(value);
}

export function StepSeal({ campaign }: { campaign: CampaignInfo }) {
  const { files, variants, scrubbed, tokens, sealSteps, addSealStep, patch, setStep } =
    useReporter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = sealSteps.length >= plannedSteps.length;

  async function seal() {
    const token = tokens[0];
    if (!scrubbed || !token) return;
    setRunning(true);
    setError(null);
    patch({ sealSteps: [] });
    try {
      const jitterMs =
        campaign.mode === "showcase" ? 1800 + Math.random() * 1800 : 4000 + Math.random() * 8000;
      const receipt = await sealAndSubmit({
        campaign,
        token,
        files,
        variants,
        scrubbed,
        jitterMs,
        onStep: addSealStep,
      });
      patch({ receipt, tokens: tokens.slice(1) });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Your report was not sent: ${cause.message}`
          : "Your report was not sent. Try again.",
      );
      patch({ sealSteps: [] });
    } finally {
      setRunning(false);
    }
  }

  const sentFiles = files.length;
  const originals = variants.filter((value) => value === "original").length;

  return (
    <section>
      <StepHeading title={done ? "Sealed and sent" : "Seal and send your report"}>
        {done ? (
          <p>Everything below happened in this browser. The server only ever saw ciphertext.</p>
        ) : (
          <p>
            Your statement and {sentFiles} file{sentFiles === 1 ? "" : "s"}
            {originals ? ` (${originals} as cleaned originals)` : ""} will be locked so that any{" "}
            {campaign.threshold} of the {campaign.reviewers.length} {campaign.orgName} reviewers can
            open them together. The AI analysis sees only the hidden-name text.
          </p>
        )}
      </StepHeading>

      {!running && sealSteps.length === 0 ? (
        <div className="rounded-lg border border-line p-5">
          <h2 className="text-md font-semibold">Who can open what</h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-base sm:grid-cols-[auto_1fr]">
            <dt className="text-ink-2">Your name</dt>
            <dd>No one. It was never collected.</dd>
            <dt className="text-ink-2">Original files</dt>
            <dd>
              Any {campaign.threshold} of:{" "}
              {campaign.reviewers.map((item) => item.displayName).join(", ")}
            </dd>
            <dt className="text-ink-2">Hidden-name text</dt>
            <dd>The analysis worker, in memory only, then the same reviewers</dd>
            <dt className="text-ink-2">Candor&apos;s servers</dt>
            <dd>Encrypted data, file sizes rounded up, and the time it arrived</dd>
          </dl>
        </div>
      ) : (
        <ol className="flex flex-col" aria-live="polite">
          {plannedSteps.map((label, index) => {
            const step = sealSteps[index];
            const activeNow = running && index === sealSteps.length;
            return (
              <li key={label} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-200",
                      step
                        ? "border-seal bg-seal text-on-seal"
                        : activeNow
                          ? "border-seal text-seal"
                          : "border-line-strong text-ink-3",
                    )}
                  >
                    {step ? (
                      <Check className="size-3.5" aria-hidden="true" />
                    ) : activeNow ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-current" />
                    )}
                  </span>
                  {index < plannedSteps.length - 1 ? (
                    <span
                      className={cn(
                        "w-px flex-1 transition-colors duration-300",
                        step ? "bg-seal" : "bg-line",
                      )}
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1 pb-6">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className={cn("text-base font-medium", !step && !activeNow && "text-ink-3")}>
                      {step?.label ?? label}
                    </p>
                    {step && step.durationMs > 0 ? (
                      <span className="shrink-0 font-mono text-xs text-ink-3 tabular-nums">
                        {step.durationMs} ms
                      </span>
                    ) : null}
                  </div>
                  {step ? (
                    <div className="motion-safe:animate-[rise-in_250ms_cubic-bezier(0.22,1,0.36,1)_both]">
                      <p className="mt-1 max-w-[62ch] text-sm leading-6 text-ink-2">
                        {step.detail}
                      </p>
                      {step.values?.length ? (
                        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                          {step.values.map((value) => (
                            <div key={value.label} className="flex min-w-0 items-center gap-1.5">
                              <dt className="text-ink-3">{value.label}</dt>
                              <dd className="min-w-0">
                                {isHex(value.value) ? (
                                  <Hash value={value.value} />
                                ) : (
                                  <span className="font-mono text-xs text-ink">{value.value}</span>
                                )}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-md bg-contradicted-soft px-3 py-2 text-base text-contradicted"
        >
          {error}
        </p>
      ) : null}

      <StepActions>
        {done ? (
          <span />
        ) : (
          <Button variant="ghost" onClick={() => setStep("review")} disabled={running}>
            Back
          </Button>
        )}
        {done ? (
          <Button variant="primary" size="lg" onClick={() => setStep("receipt")}>
            Get my receipt
          </Button>
        ) : (
          <Button variant="primary" size="lg" onClick={seal} disabled={running || !scrubbed}>
            {running ? <Spinner /> : <Lock aria-hidden="true" />}
            {running ? "Sealing…" : "Seal and send"}
          </Button>
        )}
      </StepActions>
    </section>
  );
}
