"use client";

import { Check, CircleDollarSign } from "lucide-react";
import { useEffect, useState } from "react";

import { Button, Spinner } from "@/components/ui/button";
import { Hash } from "@/components/ui/hash";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import type { PaymentReceipt, PaymentRequirements } from "@/lib/console/types";

type Step = "quote" | "authorise" | "send" | "settle" | "done";

const steps: { key: Exclude<Step, "quote" | "done">; label: string; detail: string }[] = [
  {
    key: "authorise",
    label: "Authorise transfer",
    detail:
      "The organisation's wallet signs an EIP-3009 transferWithAuthorization for the exact amount.",
  },
  {
    key: "send",
    label: "Retry with X-PAYMENT",
    detail:
      "The signed payload is base64-encoded into the X-PAYMENT header and the request is replayed.",
  },
  {
    key: "settle",
    label: "Verify and settle",
    detail: "The facilitator verifies the signature and settles on-chain; the API queues the job.",
  },
];

const order: Step[] = ["quote", "authorise", "send", "settle", "done"];

export function PaySheet({
  open,
  onOpenChange,
  requirements,
  mode,
  onPay,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requirements: PaymentRequirements | null;
  mode: "showcase" | "live";
  onPay: () => Promise<PaymentReceipt>;
}) {
  const [step, setStep] = useState<Step>("quote");
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep("quote");
      setReceipt(null);
      setError(null);
    }
  }, [open]);

  async function pay() {
    setError(null);
    try {
      setStep("authorise");
      await new Promise((resolve) => setTimeout(resolve, 500));
      setStep("send");
      const result = onPay();
      await new Promise((resolve) => setTimeout(resolve, 400));
      setStep("settle");
      const paid = await result;
      setReceipt(paid);
      setStep("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment failed");
      setStep("quote");
    }
  }

  const current = order.indexOf(step);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Pay for this analysis"
      description="Analysis is billed per run to the organisation over x402. The reporter never pays and never sees a wallet."
      footer={
        step === "done" ? (
          <Button variant="primary" className="w-full" onClick={() => onOpenChange(false)}>
            Watch the pipeline
          </Button>
        ) : (
          <Button
            variant="primary"
            className="w-full"
            onClick={pay}
            loading={step !== "quote"}
            disabled={!requirements}
          >
            <CircleDollarSign aria-hidden="true" />
            Pay{" "}
            {requirements
              ? `${requirements.amountUsd.toFixed(2)} ${requirements.assetSymbol}`
              : ""}{" "}
            and run
          </Button>
        )
      }
    >
      <section>
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Server response</h3>
          <span className="font-mono text-xs text-contradicted">HTTP 402 Payment Required</span>
        </div>
        {requirements ? (
          <dl className="mt-3 grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 rounded-lg bg-surface p-3 text-sm">
            <dt className="text-ink-2">Scheme</dt>
            <dd className="font-mono text-xs">{requirements.scheme}</dd>
            <dt className="text-ink-2">Network</dt>
            <dd className="font-mono text-xs">{requirements.network}</dd>
            <dt className="text-ink-2">Amount</dt>
            <dd className="tabular font-mono text-xs">
              {requirements.maxAmountRequired} atomic = {requirements.amountUsd.toFixed(2)}{" "}
              {requirements.assetSymbol}
            </dd>
            <dt className="text-ink-2">Asset</dt>
            <dd>
              <Hash value={requirements.asset} label="asset address" />
            </dd>
            <dt className="text-ink-2">Pay to</dt>
            <dd>
              <Hash value={requirements.payTo} label="recipient address" />
            </dd>
            <dt className="text-ink-2">Resource</dt>
            <dd className="font-mono text-xs break-all">{requirements.resource}</dd>
            <dt className="text-ink-2">Timeout</dt>
            <dd className="font-mono text-xs">{requirements.maxTimeoutSeconds} s</dd>
          </dl>
        ) : (
          <div className="mt-3 flex items-center gap-2 text-sm text-ink-2">
            <Spinner /> Requesting a quote…
          </div>
        )}
      </section>

      <ol className="mt-6 flex flex-col gap-4">
        {steps.map((item) => {
          const index = order.indexOf(item.key);
          const state = current > index ? "done" : current === index ? "active" : "todo";
          return (
            <li key={item.key} className="grid grid-cols-[24px_1fr] gap-3">
              <span
                className={cn(
                  "mt-0.5 flex size-6 items-center justify-center rounded-full border text-xs",
                  state === "done" && "border-documented bg-documented text-bg",
                  state === "active" && "border-seal text-seal",
                  state === "todo" && "border-line-strong text-ink-3",
                )}
                aria-hidden="true"
              >
                {state === "done" ? (
                  <Check className="size-3.5" />
                ) : state === "active" ? (
                  <Spinner className="size-3.5" />
                ) : (
                  index
                )}
              </span>
              <div>
                <p
                  className={cn(
                    "text-base font-medium",
                    state === "todo" ? "text-ink-2" : "text-ink",
                  )}
                >
                  {item.label}
                </p>
                <p className="text-sm text-ink-2">{item.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {receipt ? (
        <section className="mt-6 rounded-lg bg-documented-soft/60 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-documented">
            <Check className="size-4" aria-hidden="true" />
            Paid. The analysis job is queued.
          </p>
          <dl className="mt-2 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1">
            <dt className="text-ink-2">Payer</dt>
            <dd className="font-mono text-xs">{receipt.payer}</dd>
            <dt className="text-ink-2">Settlement</dt>
            <dd>
              <Hash value={receipt.txRef} label="settlement reference" />
            </dd>
          </dl>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-sm text-contradicted">
          {error}
        </p>
      ) : null}

      <p className="mt-6 text-xs leading-5 text-ink-3">
        {mode === "showcase"
          ? "Showcase mode simulates the facilitator. With X402_MODE=testnet the same flow settles real test USDC on Base Sepolia."
          : "Payment records live in a separate database, linked to jobs only through a keyed HMAC. Payment metadata identifies the paying organisation, never the reporter."}
      </p>
    </Sheet>
  );
}
