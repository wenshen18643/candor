import { CircleCheck, CircleDashed, CircleX } from "lucide-react";

import { cn } from "@/lib/cn";
import type { InboxStep, StepUpdate } from "@/lib/inbox-client";

export type StepState = { status: "pending" } | StepUpdate;

const steps: { id: InboxStep; title: string; running: string; explain: string }[] = [
  {
    id: "derive",
    title: "Turning your codename into keys",
    running: "This takes a second or two on purpose.",
    explain:
      "A slow, memory-heavy recipe (Argon2id) makes guessing codenames very slow for anyone else.",
  },
  {
    id: "prove",
    title: "Proving it's you",
    running: "Signing a one-time challenge.",
    explain: "Your device signs a fresh challenge. The codename itself is never sent.",
  },
  {
    id: "open",
    title: "Opening your messages",
    running: "Unsealing messages on this device.",
    explain: "Messages are locked to your inbox key, so only this device can read them.",
  },
];

export function UnlockProgress({ states }: { states: Record<InboxStep, StepState> }) {
  return (
    <ol className="flex flex-col gap-1" aria-label="Unlocking your inbox">
      {steps.map((step) => {
        const state = states[step.id];
        const running = state.status === "running";
        const done = state.status === "done";
        const failed = state.status === "error";
        return (
          <li
            key={step.id}
            className={cn(
              "grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 rounded-lg px-3 py-3 transition-colors duration-200",
              running && "bg-surface",
            )}
            aria-current={running ? "step" : undefined}
          >
            <span className="mt-0.5" aria-hidden="true">
              {done ? (
                <CircleCheck className="size-5 text-documented" />
              ) : failed ? (
                <CircleX className="size-5 text-contradicted" />
              ) : running ? (
                <span className="relative flex size-5 items-center justify-center">
                  <span className="size-2.5 animate-[pulse-ring_1.1s_var(--ease-out-quart)_infinite] rounded-full bg-seal" />
                </span>
              ) : (
                <CircleDashed className="size-5 text-ink-3" />
              )}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span
                  className={cn(
                    "text-base font-medium",
                    state.status === "pending" ? "text-ink-2" : "text-ink",
                  )}
                >
                  {step.title}
                </span>
                {done ? (
                  <span className="tabular text-sm text-ink-2">
                    {state.ms < 1000
                      ? `${Math.max(1, Math.round(state.ms))} ms`
                      : `${(state.ms / 1000).toFixed(1)} s`}
                  </span>
                ) : null}
              </div>
              {running ? (
                <>
                  <span className="text-sm text-ink-2">{step.running}</span>
                  <span
                    className="relative mt-1 block h-1 overflow-hidden rounded-full bg-surface-3"
                    role="progressbar"
                    aria-label={step.title}
                    aria-busy="true"
                  >
                    <span className="absolute inset-y-0 left-0 w-2/5 animate-[sweep_1.3s_linear_infinite] rounded-full bg-seal will-change-transform" />
                  </span>
                </>
              ) : null}
              {done ? (
                <span className="text-sm text-ink-2">
                  {step.explain}{" "}
                  <span className="font-mono text-xs text-ink-3">{state.detail}</span>
                </span>
              ) : null}
              {failed ? <span className="text-sm text-contradicted">{state.message}</span> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
