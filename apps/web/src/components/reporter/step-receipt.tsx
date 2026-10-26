"use client";

import { Check, Copy, Inbox, ScrollText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Hash } from "@/components/ui/hash";
import { cn } from "@/lib/cn";
import { useReporter } from "@/lib/reporter/store";

import { Disclosure, StepHeading } from "./parts";

export function StepReceipt() {
  const receipt = useReporter((state) => state.receipt);
  const reset = useReporter((state) => state.reset);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [finished, setFinished] = useState(false);

  if (!receipt) return null;
  const words = receipt.codename.split(/[\s-]+/);

  async function copy() {
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(receipt.codename);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  if (finished)
    return (
      <section>
        <StepHeading title="You're done">
          <p>Close this tab when you&apos;re ready. Check for replies in a few days.</p>
        </StepHeading>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href="/inbox" className={buttonVariants({ variant: "primary", size: "lg" })}>
            <Inbox aria-hidden="true" />
            Check for replies
          </Link>
          <Link href="/" className={buttonVariants({ variant: "secondary", size: "lg" })}>
            Back to Candor
          </Link>
        </div>
      </section>
    );

  return (
    <section>
      <StepHeading title="Your report is sealed and sent">
        <p>
          Write down these eight words. They&apos;re the only way to read and answer questions. We
          can&apos;t recover them.
        </p>
      </StepHeading>

      <div className="rounded-lg border border-seal/40 bg-seal-soft p-4 sm:p-5">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {words.map((word, index) => (
            <li
              key={`${word}-${index}`}
              className="flex items-baseline gap-2 rounded-md bg-bg px-3 py-2.5"
            >
              <span className="w-4 text-right font-mono text-xs text-ink-3 tabular-nums">
                {index + 1}
              </span>
              <span className="font-mono text-md font-semibold text-ink">{word}</span>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="secondary" onClick={copy} className="self-start">
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? "Copied" : "Copy words"}
          </Button>
          <label className="flex cursor-pointer items-center gap-2 text-base">
            <input
              type="checkbox"
              checked={saved}
              onChange={(event) => setSaved(event.target.checked)}
              className="size-4 accent-[var(--color-seal)]"
            />
            I wrote them down somewhere safe
          </label>
        </div>
      </div>

      <Disclosure summary="Proof of what you sent" className="mt-8">
        <p className="max-w-[62ch] text-base leading-6 text-ink-2">
          A fingerprint of your files is now in a public log. It proves what you sent and when.
        </p>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-base sm:grid-cols-[auto_1fr]">
          <dt className="text-ink-2">Evidence root</dt>
          <dd>
            <Hash value={receipt.evidenceRoot} head={12} tail={8} />
          </dd>
          <dt className="text-ink-2">Log position</dt>
          <dd className="tabular-nums">
            Entry {receipt.logIndex.toLocaleString()} of {receipt.treeSize.toLocaleString()}
          </dd>
          <dt className="text-ink-2">Signed tree head</dt>
          <dd>
            <Hash value={receipt.rootHash} head={12} tail={8} />
          </dd>
          <dt className="text-ink-2">Sent</dt>
          <dd>
            {new Date(receipt.submittedAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}{" "}
            <span className="text-ink-3">
              · {receipt.bytesSent.toLocaleString()} bytes, all encrypted
            </span>
          </dd>
        </dl>
        <Link
          href="/audit"
          className={cn(buttonVariants({ variant: "link" }), "mt-3 inline-flex gap-1.5")}
        >
          <ScrollText className="size-4" aria-hidden="true" />
          See the public log
        </Link>
      </Disclosure>

      <div className="mt-10 flex flex-col-reverse gap-2 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-2">Finishing clears your words from this page.</p>
        <Button
          variant="primary"
          size="lg"
          disabled={!saved}
          onClick={() => {
            reset();
            setFinished(true);
          }}
        >
          Finish
        </Button>
      </div>
    </section>
  );
}
