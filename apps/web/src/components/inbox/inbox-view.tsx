"use client";

import { Lock, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  createInboxClient,
  InboxError,
  type InboxSession,
  type InboxStep,
  type ReplyDraft,
  type StepUpdate,
  type Thread,
} from "@/lib/inbox-client";

import { CodenameForm } from "./codename-form";
import { Conversation } from "./conversation";
import { type StepState, UnlockProgress } from "./unlock-progress";

type Phase =
  | { name: "locked"; error: string | null }
  | { name: "opening" }
  | { name: "open"; session: InboxSession };

const pendingStates: Record<InboxStep, StepState> = {
  derive: { status: "pending" },
  prove: { status: "pending" },
  open: { status: "pending" },
};

const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

export function InboxView() {
  const client = useMemo(() => createInboxClient(), []);
  const [phase, setPhase] = useState<Phase>({ name: "locked", error: null });
  const [states, setStates] = useState<Record<InboxStep, StepState>>(pendingStates);
  const [threads, setThreads] = useState<Thread[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sessionRef = useRef<InboxSession | null>(null);

  const lock = useCallback((message: string | null = null) => {
    sessionRef.current?.lock();
    sessionRef.current = null;
    setThreads([]);
    setStates(pendingStates);
    setPhase({ name: "locked", error: message });
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => () => sessionRef.current?.lock(), []);

  useEffect(() => {
    if (phase.name !== "open") return;
    const remaining = new Date(phase.session.expiresAt).getTime() - Date.now();
    if (!Number.isFinite(remaining)) return;
    const timer = window.setTimeout(
      () => lock("Your inbox locked itself after 30 minutes. Type your codename to open it again."),
      Math.max(remaining, 0),
    );
    return () => window.clearTimeout(timer);
  }, [phase, lock]);

  async function open(codename: string) {
    setStates(pendingStates);
    setPhase({ name: "opening" });
    try {
      const session = await client.open(codename, (update: StepUpdate) =>
        setStates((previous) => ({ ...previous, [update.step]: update })),
      );
      sessionRef.current = session;
      setThreads(session.threads);
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      setPhase({ name: "open", session });
      window.setTimeout(() => headingRef.current?.focus(), 0);
    } catch (error) {
      const message =
        error instanceof InboxError
          ? error.message
          : "Something went wrong while opening your inbox. Try again.";
      if (error instanceof InboxError)
        setStates((previous) => ({
          ...previous,
          [error.step]: { step: error.step, status: "error", message },
        }));
      setPhase({ name: "locked", error: message });
    }
  }

  async function send(reportId: string, draft: ReplyDraft) {
    const session = sessionRef.current;
    if (!session) throw new Error("Your inbox is locked. Open it again to reply.");
    const reply = await session.sendReply(reportId, draft);
    setThreads((previous) =>
      previous.map((thread) =>
        thread.report_id === reportId
          ? { ...thread, items: [...thread.items, { type: "outgoing", reply }] }
          : thread,
      ),
    );
    return reply;
  }

  if (phase.name === "opening")
    return (
      <div className="flex flex-col gap-6" aria-live="polite">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Opening your inbox</h1>
          <p className="text-md text-ink-2">Everything below happens on this device.</p>
        </div>
        <UnlockProgress states={states} />
      </div>
    );

  if (phase.name === "open") {
    const session = phase.session;
    const showcase = session.mode === "showcase";
    return (
      <div className="flex flex-col gap-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-[-0.02em] outline-none"
            >
              Your inbox
            </h1>
            <p className="text-sm text-ink-2">
              Inbox ID{" "}
              <span className="font-mono text-xs text-ink">{session.inboxId.slice(0, 12)}</span>
              {" · "}locks at {clock.format(new Date(session.expiresAt))} UTC
            </p>
          </div>
          <Button variant="secondary" onClick={() => lock()}>
            <Lock aria-hidden="true" />
            Lock
          </Button>
        </div>

        {showcase ? (
          <p className="rounded-lg border border-dashed border-line-strong px-4 py-3 text-sm text-ink-2">
            {threads.length
              ? "Demo inbox. The review team's message below was sealed to the demo inbox key on this device, standing in for the server. Your reply is sealed for real, but not sent anywhere."
              : "Demo mode. Only the demo codename has messages waiting."}
          </p>
        ) : null}

        {threads.length === 0 ? (
          <div className="flex flex-col items-start gap-4 rounded-xl bg-surface px-5 py-5">
            <p className="text-md text-ink">No reports are linked to this codename.</p>
            <p className="text-base text-ink-2">
              Check each word against your receipt. Every codename has exactly 8 words, and a single
              wrong letter opens a different, empty inbox.
            </p>
            <Button variant="secondary" onClick={() => lock()}>
              <RotateCcw aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : (
          threads.map((thread) => (
            <Conversation
              key={thread.report_id}
              thread={thread}
              organisation={session.organisation}
              recipients={session.recipients}
              showcase={showcase}
              onSend={send}
            />
          ))
        )}

        <details className="rounded-lg border border-line px-4 py-3">
          <summary className="cursor-pointer text-sm text-ink-2 select-none hover:text-ink">
            How your inbox was opened
          </summary>
          <div className="mt-3">
            <UnlockProgress states={states} />
          </div>
        </details>
      </div>
    );
  }

  return (
    <CodenameForm
      demoCodename={client.demoCodename}
      error={phase.error}
      inputRef={inputRef}
      onSubmit={open}
    />
  );
}
