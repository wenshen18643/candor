"use client";

import { Check, ShieldCheck } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Spinner } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { mintTokens, mockVerify, pollVerification, startVerification } from "@/lib/reporter/engine";
import { useReporter } from "@/lib/reporter/store";
import type { CampaignInfo, SelfSession } from "@/lib/reporter/types";

import { StepActions, StepHeading } from "./parts";

const SelfQr = dynamic(() => import("./self-qr"), {
  ssr: false,
  loading: () => <div className="size-[240px] animate-pulse rounded-lg bg-surface-2" />,
});

type Phase = "idle" | "verifying" | "minting" | "minted" | "rejected";

const rejectionCopy: Record<string, string> = {
  quota_exhausted:
    "This passport has already made 3 reports to this channel this month. You can report again next month.",
  underage: "You must be 18 or older to use this channel.",
  sanctioned: "This channel can't accept a report from this passport.",
};

function shorten(value: string, size = 10) {
  return value.length > size * 2 ? `${value.slice(0, size)}…${value.slice(-4)}` : value;
}

function MintLedger({
  blinded,
  signatures,
  tokens,
  stage,
}: {
  blinded: string[];
  signatures: string[];
  tokens: string[];
  stage: number;
}) {
  const columns = [
    { title: "Blinded by your browser", values: blinded, active: stage >= 1 },
    { title: "Signed by the issuer", values: signatures, active: stage >= 2 },
    { title: "Unblinded token", values: tokens, active: stage >= 3 },
  ];
  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-line">
      <div className="grid grid-cols-3 border-b border-line bg-surface text-xs font-medium text-ink-2">
        {columns.map((column) => (
          <div key={column.title} className="px-3 py-2">
            {column.title}
          </div>
        ))}
      </div>
      {blinded.map((_, row) => (
        <div key={row} className="grid grid-cols-3 border-b border-line last:border-b-0">
          {columns.map((column, index) => (
            <div key={column.title} className="min-w-0 px-3 py-2.5">
              {column.active ? (
                <code
                  style={{ animationDelay: `${row * 80}ms` }}
                  className={cn(
                    "motion-safe:animate-[fade-in_350ms_ease-out_both]",
                    "block truncate font-mono text-xs",
                    index === 2 ? "text-seal-ink" : "text-ink-2",
                  )}
                >
                  {shorten(column.values[row] ?? "")}
                </code>
              ) : (
                <span className="block h-4 w-3/4 rounded bg-surface-2" />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function MintExplainer({ stage, count }: { stage: number; count: number }) {
  const lines = [
    `Your browser made ${count} random tokens and hid each one inside a blinded message.`,
    "The issuer checked your proof and signed the blinded messages without seeing the tokens.",
    "Your browser removed the blinding. The signatures still check out, but the issuer has never seen these tokens, so it can't link them to your scan.",
  ];
  return (
    <ol className="mt-5 flex flex-col gap-2.5">
      {lines.map((line, index) => (
        <li
          key={line}
          className={cn(
            "flex gap-3 text-base leading-6 transition-colors duration-300",
            stage > index ? "text-ink" : "text-ink-3",
          )}
        >
          <span
            className={cn(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold transition-colors duration-300",
              stage > index ? "bg-seal text-on-seal" : "bg-surface-2 text-ink-3",
            )}
          >
            {stage > index ? <Check className="size-3" aria-hidden="true" /> : index + 1}
          </span>
          {line}
        </li>
      ))}
    </ol>
  );
}

export function StepVerify({ campaign }: { campaign: CampaignInfo }) {
  const { session, tokens, mintTrace, patch, setStep } = useReporter();
  const [phase, setPhase] = useState<Phase>(tokens.length > 0 ? "minted" : "idle");
  const [reason, setReason] = useState<string | null>(null);
  const [stage, setStage] = useState(tokens.length > 0 ? 3 : 0);
  const [error, setError] = useState<string | null>(null);
  const personaRef = useRef("persona-a");

  useEffect(() => {
    if (session) return;
    startVerification(campaign)
      .then((value) => patch({ session: value }))
      .catch(() => setError("Couldn't start verification. Check your connection and try again."));
  }, [campaign, session, patch]);

  const mint = useCallback(
    async (active: SelfSession, allowance: number) => {
      setPhase("minting");
      const count = Math.max(1, Math.min(allowance, 3));
      const result = await mintTokens(campaign, active, count, personaRef.current);
      patch({
        tokens: result.tokens,
        mintTrace: { blinded: result.blinded, signatures: result.signatures },
      });
      for (const next of [1, 2, 3]) {
        setStage(next);
        await new Promise((resolve) => setTimeout(resolve, 650));
      }
      setPhase("minted");
    },
    [campaign, patch],
  );

  const settle = useCallback(
    async (active: SelfSession, verdict: Awaited<ReturnType<typeof mockVerify>>) => {
      patch({ verification: verdict });
      if (verdict.status === "rejected") {
        setReason(verdict.reason);
        setPhase("rejected");
        return;
      }
      await mint(active, verdict.allowance);
    },
    [mint, patch],
  );

  async function verifyWithPersona(persona: string) {
    if (!session) return;
    personaRef.current = persona;
    setError(null);
    setPhase("verifying");
    try {
      await settle(session, await mockVerify(campaign, session, persona));
    } catch (cause) {
      setPhase("idle");
      setError(cause instanceof Error ? cause.message : "Verification failed.");
    }
  }

  async function waitForProof() {
    if (!session) return;
    setPhase("verifying");
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const verdict = await pollVerification(session).catch(() => null);
      if (verdict) {
        await settle(session, verdict);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    setPhase("idle");
    setError("We didn't receive your proof. Try scanning again.");
  }

  const isMock = session?.mode === "mock";

  return (
    <section>
      <StepHeading title="Prove you can report, without saying who you are">
        <p>
          The Self app reads the chip in your passport on your phone and makes a zero-knowledge
          proof: you are over 18 and not on a sanctions list. That is all Candor learns. Each
          passport can make up to 3 reports here each month, and those reports can&apos;t be linked
          to each other.
        </p>
      </StepHeading>

      {phase === "idle" || phase === "verifying" || phase === "rejected" ? (
        <div className="rounded-lg border border-line p-5">
          {!session ? (
            <div className="flex items-center gap-2 text-base text-ink-2">
              <Spinner /> Preparing a verification session…
            </div>
          ) : isMock ? (
            <div>
              <h2 className="text-md font-semibold">Demo verification</h2>
              <p className="mt-1 max-w-[60ch] text-base leading-6 text-ink-2">
                This demo uses test passports, so you don&apos;t need the Self app. The rest of the
                flow, including the blind signatures, runs for real.
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                {[
                  { id: "persona-a", label: "Use test passport A" },
                  { id: "persona-b", label: "Use test passport B" },
                ].map((persona) => (
                  <Button
                    key={persona.id}
                    variant={persona.id === "persona-a" ? "primary" : "secondary"}
                    onClick={() => verifyWithPersona(persona.id)}
                    disabled={phase === "verifying"}
                    loading={phase === "verifying" && personaRef.current === persona.id}
                  >
                    <ShieldCheck aria-hidden="true" />
                    {persona.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <SelfQr
                session={session}
                onScanned={() => void waitForProof()}
                onError={(value) => setError(rejectionCopy[value] ?? "Verification failed.")}
              />
              <div className="max-w-[40ch]">
                <h2 className="text-md font-semibold">Scan with the Self app</h2>
                <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-base leading-6 text-ink-2">
                  <li>Install Self from your app store and add your passport.</li>
                  <li>Scan this code. Check that the request says &quot;Candor&quot;.</li>
                  <li>Approve. This page continues by itself.</li>
                </ol>
                {phase === "verifying" ? (
                  <p className="mt-3 flex items-center gap-2 text-sm text-ink-2">
                    <Spinner /> Waiting for your proof…
                  </p>
                ) : null}
              </div>
            </div>
          )}
          {phase === "rejected" && reason ? (
            <p
              role="alert"
              className="mt-4 rounded-md bg-contradicted-soft px-3 py-2 text-base text-contradicted"
            >
              {rejectionCopy[reason] ?? "This proof was not accepted."}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-4 text-sm text-contradicted">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2 text-md font-semibold">
            {phase === "minted" ? (
              <span className="flex size-6 items-center justify-center rounded-full bg-documented-soft text-documented">
                <Check className="size-3.5" aria-hidden="true" />
              </span>
            ) : (
              <Spinner />
            )}
            {phase === "minted"
              ? "Verified. Your report tokens are ready."
              : "Minting your report tokens…"}
          </div>
          <MintExplainer stage={stage} count={mintTrace?.blinded.length ?? 3} />
          {mintTrace ? (
            <MintLedger
              blinded={mintTrace.blinded}
              signatures={mintTrace.signatures}
              tokens={tokens.map((token) => token.prepared)}
              stage={stage}
            />
          ) : null}
          <p className="mt-3 text-sm text-ink-3">
            RSA blind signatures (RFC 9474, RSABSSA-SHA384-PSS). Tokens stay in this tab only.
          </p>
        </div>
      )}

      <StepActions>
        <Button variant="ghost" onClick={() => setStep("intro")}>
          Back
        </Button>
        <Button
          variant="primary"
          size="lg"
          disabled={phase !== "minted"}
          onClick={() => setStep("evidence")}
        >
          Continue
        </Button>
      </StepActions>
    </section>
  );
}
