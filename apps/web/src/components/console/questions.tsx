"use client";

import { Lock, Send } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { useConsole } from "@/lib/console/store";
import type { ReportDetail, ThreadMessage } from "@/lib/console/types";
import { formatDateTime } from "@/lib/format";
import type { AnalysisResult, PseudonymEntry } from "@/lib/types";

import { PseudoText, RefChip } from "./rich-text";

const gapLabels: Record<string, string> = {
  who: "Who",
  what: "What",
  when: "When",
  where: "Where",
  how: "How",
  evidence: "Evidence",
  corroboration: "Corroboration",
};

function Thread({ messages, map }: { messages: ThreadMessage[]; map: PseudonymEntry[] | null }) {
  if (messages.length === 0) {
    return (
      <p className="text-sm text-ink-3">
        No messages yet. Questions you send are encrypted to the reporter&apos;s inbox key; only
        their codename can open them.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {messages.map((message) => {
        const fromReporter = message.direction === "to_reviewers";
        return (
          <li
            key={message.id}
            className={cn(
              "max-w-[560px] rounded-lg px-4 py-3",
              fromReporter ? "bg-surface-2" : "ml-auto bg-seal-soft/70",
            )}
          >
            <p className="mb-1 flex items-center justify-between gap-3 text-xs text-ink-2">
              <span className="font-medium text-ink">
                {fromReporter ? "Reporter (anonymous)" : message.author}
              </span>
              <span>{formatDateTime(message.sentAt)}</span>
            </p>
            <p className="text-base leading-6 text-ink">
              <PseudoText text={message.body} map={map} />
            </p>
            {message.questions.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1 border-t border-ink/10 pt-2 text-sm text-ink-2">
                {message.questions.map((question) => (
                  <li key={question.questionId}>
                    <PseudoText text={question.text} map={map} />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function Questions({
  analysis,
  detail,
  map,
  onClaim,
  onSent,
}: {
  analysis: AnalysisResult;
  detail: ReportDetail;
  map: PseudonymEntry[] | null;
  onClaim: (id: string) => void;
  onSent: () => void;
}) {
  const { client } = useConsole();
  const ordered = [...analysis.follow_up_questions].sort(
    (a, b) => a.priority - b.priority || b.expected_information_gain - a.expected_information_gain,
  );
  const alreadySent = new Set(
    detail.messages.flatMap((message) => message.questions.map((question) => question.questionId)),
  );
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        ordered
          .filter((item) => !alreadySent.has(item.question_id))
          .slice(0, 2)
          .map((item) => item.question_id),
      ),
  );
  const [note, setNote] = useState(
    "Thank you. These questions would help us understand what happened.",
  );
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function send() {
    setSending(true);
    try {
      await client.sendQuestions(
        detail.summary.reportId,
        note,
        ordered
          .filter((item) => selected.has(item.question_id))
          .map((item) => ({ questionId: item.question_id, text: item.question })),
      );
      setSent(true);
      setSelected(new Set());
      onSent();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <section>
        <h3 className="text-base font-semibold">Suggested follow-up questions</h3>
        <p className="mt-1 max-w-[60ch] text-sm text-ink-2">
          Generated from the weakest parts of the account and checked to never ask the reporter
          about their own identity. Nothing is sent until you choose.
        </p>
        <ul className="mt-4 flex flex-col gap-3">
          {ordered.map((question) => {
            const checked = selected.has(question.question_id);
            const done = alreadySent.has(question.question_id);
            return (
              <li key={question.question_id}>
                <label
                  className={cn(
                    "grid cursor-pointer grid-cols-[20px_1fr] gap-3 rounded-lg border p-3 transition-colors duration-150",
                    checked
                      ? "border-seal bg-seal-soft/40"
                      : "border-line hover:border-line-strong",
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[var(--seal)]"
                    checked={checked}
                    onChange={() => toggle(question.question_id)}
                  />
                  <span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={question.priority === 1 ? "seal" : "neutral"}>
                        Priority {question.priority}
                      </Badge>
                      <Badge tone="outline">
                        {gapLabels[question.gap_type] ?? question.gap_type}
                      </Badge>
                      {done ? <Badge tone="documented">Sent</Badge> : null}
                      <span
                        className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-3"
                        title="Expected information gain"
                      >
                        <span
                          className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-3"
                          aria-hidden="true"
                        >
                          <span
                            className="block h-full bg-seal"
                            style={{ width: `${question.expected_information_gain * 100}%` }}
                          />
                        </span>
                        <span className="tabular">
                          {Math.round(question.expected_information_gain * 100)}
                        </span>
                      </span>
                    </span>
                    <span className="mt-1.5 block text-base leading-6 text-ink">
                      <PseudoText text={question.question} map={map} />
                    </span>
                    <span className="mt-1 block text-sm text-ink-2">
                      <PseudoText text={question.rationale} map={map} />{" "}
                      {question.related_claim_ids.map((id) => (
                        <RefChip key={id} id={id} onSelect={onClaim} />
                      ))}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex flex-col gap-3">
          <Field label="Message to the reporter" htmlFor="question-note">
            <Textarea
              id="question-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="min-h-20"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              onClick={send}
              loading={sending}
              disabled={selected.size === 0}
            >
              <Send aria-hidden="true" />
              Encrypt and send{" "}
              {selected.size > 0
                ? `${selected.size} question${selected.size === 1 ? "" : "s"}`
                : ""}
            </Button>
            <span className="inline-flex items-center gap-1.5 text-sm text-ink-2">
              <Lock className="size-3.5" aria-hidden="true" />
              Sealed to the reporter&apos;s inbox key
            </span>
          </div>
          {sent ? (
            <p className="text-sm text-documented" role="status">
              Sent. The reporter sees it next time they open their inbox with their codename.
            </p>
          ) : null}
        </div>
      </section>
      <section>
        <h3 className="text-base font-semibold">Conversation</h3>
        <div className="mt-4">
          <Thread messages={detail.messages} map={map} />
        </div>
      </section>
    </div>
  );
}
