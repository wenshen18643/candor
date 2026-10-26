"use client";

import { CircleCheck, LockKeyhole, Send } from "lucide-react";
import { useId, useState } from "react";

import { SealMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatBytes, truncateMiddle } from "@/lib/format";
import type {
  Question,
  Recipient,
  ReplyDraft,
  ReviewerMessage,
  SentReply,
  Thread,
} from "@/lib/inbox-client";

const statusWords: Record<string, string> = {
  received: "Received",
  triage: "Being reviewed",
  investigating: "Being looked into",
  closed: "Closed",
};

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

function when(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${timeFormat.format(date)} UTC`;
}

function names(list: { display_name: string }[]) {
  const items = list.map((item) => item.display_name);
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function Conversation({
  thread,
  organisation,
  recipients,
  showcase,
  onSend,
}: {
  thread: Thread;
  organisation: string;
  recipients: Recipient[];
  showcase: boolean;
  onSend: (reportId: string, draft: ReplyDraft) => Promise<SentReply>;
}) {
  const questions = thread.items.flatMap((item) =>
    item.type === "incoming" ? item.message.questions : [],
  );
  return (
    <section aria-label="Messages about your report" className="flex flex-col gap-6">
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
        <span>Your report</span>
        <span aria-hidden="true">·</span>
        <span className="text-ink">{statusWords[thread.status] ?? thread.status}</span>
      </p>
      <ol className="flex flex-col gap-4" aria-label="Conversation">
        {thread.items.map((item) =>
          item.type === "incoming" ? (
            <li key={item.message.id}>
              <IncomingMessage message={item.message} organisation={organisation} />
            </li>
          ) : (
            <li key={item.reply.id} className="flex justify-end">
              <OutgoingReply reply={item.reply} questions={questions} showcase={showcase} />
            </li>
          ),
        )}
      </ol>
      {thread.items.length === 0 ? (
        <p className="rounded-lg bg-surface px-4 py-4 text-base text-ink-2">
          No messages yet. When the review team has a question, it will appear here. Check back in a
          few days.
        </p>
      ) : null}
      {questions.length > 0 || thread.items.length > 0 ? (
        <Composer
          reportId={thread.report_id}
          questions={questions}
          recipients={recipients}
          showcase={showcase}
          onSend={onSend}
        />
      ) : null}
    </section>
  );
}

function IncomingMessage({
  message,
  organisation,
}: {
  message: ReviewerMessage;
  organisation: string;
}) {
  return (
    <article className="flex flex-col gap-4 rounded-xl bg-surface px-4 py-4 sm:px-5">
      <header className="flex items-start gap-3">
        <SealMark className="mt-0.5 size-6 shrink-0" />
        <div className="flex min-w-0 flex-col">
          <span className="text-base font-medium text-ink">{organisation} review team</span>
          <span className="text-sm text-ink-2">{when(message.sent_at)}</span>
        </div>
      </header>
      {message.body ? <p className="text-md text-ink">{message.body}</p> : null}
      {message.questions.length ? (
        <ol className="flex flex-col gap-3">
          {message.questions.map((question, index) => (
            <li key={question.question_id} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2">
              <span className="tabular text-md font-semibold text-ink-2">{index + 1}.</span>
              <span className="text-md text-ink">{question.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="flex items-center gap-1.5 text-xs text-ink-2">
        <LockKeyhole className="size-3.5" aria-hidden="true" />
        Sealed to your inbox key ({formatBytes(message.sealed_bytes)}). Opened only on this device.
      </p>
    </article>
  );
}

function OutgoingReply({
  reply,
  questions,
  showcase,
}: {
  reply: SentReply;
  questions: Question[];
  showcase: boolean;
}) {
  const byId = new Map(
    questions.map((question, index) => [question.question_id, { question, index }]),
  );
  return (
    <article className="flex w-full max-w-[92%] flex-col gap-3 rounded-xl bg-seal-soft px-4 py-4 sm:px-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-base font-medium text-ink">You</span>
        <span className="text-sm text-ink-2">{when(reply.created_at)}</span>
      </header>
      {reply.body === null && reply.answers.length === 0 ? (
        <p className="text-base text-ink-2">
          Your earlier reply. It was sealed to the reviewers, so even this device cannot read it
          now.
        </p>
      ) : null}
      {reply.answers.map((answer) => {
        const match = byId.get(answer.question_id);
        return (
          <div key={answer.question_id} className="flex flex-col gap-0.5">
            <span className="text-sm text-ink-2">
              {match ? `Answer to question ${match.index + 1}` : "Answer"}
            </span>
            <p className="text-md whitespace-pre-wrap text-ink">{answer.text}</p>
          </div>
        );
      })}
      {reply.body ? <p className="text-md whitespace-pre-wrap text-ink">{reply.body}</p> : null}
      <p className="flex items-start gap-1.5 text-xs text-ink-2">
        <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Sealed separately to {names(reply.sealed)}.
          {showcase && !reply.delivered ? " Demo only: nothing left this device." : ""}
        </span>
      </p>
    </article>
  );
}

function Composer({
  reportId,
  questions,
  recipients,
  showcase,
  onSend,
}: {
  reportId: string;
  questions: Question[];
  recipients: Recipient[];
  showcase: boolean;
  onSend: (reportId: string, draft: ReplyDraft) => Promise<SentReply>;
}) {
  const id = useId();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SentReply | null>(null);
  const hasContent = body.trim().length > 0 || Object.values(answers).some((text) => text.trim());

  async function send() {
    if (!hasContent || sending) return;
    setSending(true);
    setError(null);
    try {
      const sent = await onSend(reportId, {
        body,
        answers: questions.map((question) => ({
          question_id: question.question_id,
          text: answers[question.question_id] ?? "",
        })),
      });
      setReceipt(sent);
      setAnswers({});
      setBody("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Your reply could not be sent. Nothing was lost; try again.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="mt-4 flex flex-col gap-5 border-t border-line pt-8"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id={`${id}-heading`} className="text-xl font-semibold">
          Your reply
        </h2>
        <p className="text-base text-ink-2">
          Answer only what you feel safe sharing. You can skip any question.
        </p>
      </div>

      {receipt ? (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-xl bg-documented-soft px-4 py-4 sm:px-5"
        >
          <p className="flex items-center gap-2 text-base font-medium text-documented">
            <CircleCheck className="size-5 shrink-0" aria-hidden="true" />
            Sealed to {receipt.sealed.length} reviewers
          </p>
          <ul className="flex flex-col gap-1.5">
            {receipt.sealed.map((copy) => (
              <li
                key={copy.reviewer_id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"
              >
                <span className="text-ink">{copy.display_name}</span>
                <span className="font-mono text-xs text-ink-2">
                  key {truncateMiddle(copy.key_id, 6, 4)} · {formatBytes(copy.bytes)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-2">
            {showcase
              ? "Demo only: each copy was sealed on this device and nothing was sent."
              : "Each reviewer got their own sealed copy. The server only stores the sealed boxes."}{" "}
            Copies are padded so their size says little about how much you wrote.
          </p>
        </div>
      ) : null}

      {questions.map((question, index) => {
        const fieldId = `${id}-q-${question.question_id}`;
        return (
          <div key={question.question_id} className="flex flex-col gap-1.5">
            <label htmlFor={fieldId} className="text-base text-ink">
              <span className="tabular font-semibold text-ink-2">{index + 1}.</span> {question.text}
            </label>
            <textarea
              id={fieldId}
              rows={3}
              value={answers[question.question_id] ?? ""}
              onChange={(event) =>
                setAnswers((previous) => ({
                  ...previous,
                  [question.question_id]: event.target.value,
                }))
              }
              placeholder="Skip this if you are not sure"
              className={textareaClass}
            />
          </div>
        );
      })}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-body`} className="text-base text-ink">
          Anything else you want the team to know
        </label>
        <textarea
          id={`${id}-body`}
          rows={4}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Optional"
          className={textareaClass}
        />
      </div>

      <p className="rounded-lg bg-info-soft px-4 py-3 text-base text-ink">
        Before you send, leave out your name, your job title and details only you would know, like
        your exact shift times.
      </p>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-ink-2">
          {recipients.length
            ? `Your reply will be sealed separately to ${recipients.length} reviewers:`
            : "The reviewers' keys are not available right now."}
        </span>
        <ul className="flex flex-wrap gap-1.5">
          {recipients.map((recipient) => (
            <li
              key={recipient.reviewer_id}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-sm text-ink"
            >
              {recipient.display_name}
              <span className="font-mono text-2xs text-ink-2">
                {truncateMiddle(recipient.key_id, 4, 4)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {error ? (
        <p className="text-base text-contradicted" role="alert">
          {error}
        </p>
      ) : null}

      <Button
        variant="primary"
        size="lg"
        className="w-full sm:w-auto sm:self-start"
        onClick={send}
        disabled={!hasContent || recipients.length === 0}
        loading={sending}
      >
        {sending ? null : <Send aria-hidden="true" />}
        {sending ? "Sealing…" : "Seal and send"}
      </Button>
    </section>
  );
}

const textareaClass = cn(
  "w-full resize-y rounded-lg border border-line-strong bg-bg px-3.5 py-2.5 text-md leading-6 text-ink transition-colors duration-150 placeholder:text-ink-3 hover:border-ink-3 focus-visible:border-seal focus-visible:ring-2 focus-visible:ring-seal/25 focus-visible:outline-none",
);
