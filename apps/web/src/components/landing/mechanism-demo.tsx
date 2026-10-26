"use client";

import { ArrowRight, Check, Lock, Pause, Play } from "lucide-react";
import {
  animate,
  AnimatePresence,
  motion,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { truncateMiddle } from "@/lib/format";

import {
  emailSegments,
  emailSizes,
  illustrativeSeal,
  nameMap,
  originalEmail,
  piiSummary,
  randomB64uChar,
  reviewers,
  type SealResult,
} from "./demo-data";
import { sealInBrowser } from "./live-seal";

const easeOutExpo: [number, number, number, number] = [0.16, 1, 0.3, 1];
const easeOutQuart: [number, number, number, number] = [0.25, 1, 0.5, 1];

const stages = [
  { label: "Detect", duration: 4200 },
  { label: "Replace", duration: 4600 },
  { label: "Seal", duration: 4600 },
  { label: "Split key", duration: 6400 },
];

type SealStatus = "pending" | "live" | "fallback";

const piiOrder = (() => {
  let next = 0;
  return emailSegments.map((segment) => (segment.kind === "pii" ? next++ : -1));
})();

export function MechanismDemo() {
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { amount: 0.3 });
  const reduce = useReducedMotion() ?? false;
  const [stage, setStage] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [seal, setSeal] = useState<SealResult>(illustrativeSeal);
  const [status, setStatus] = useState<SealStatus>("pending");
  const sealStarted = useRef(false);

  useEffect(() => {
    if (!playing || !inView || reduce) return;
    const current = stages[stage];
    if (!current) return;
    const timer = window.setTimeout(() => {
      if (stage === stages.length - 1) {
        setCycle((value) => value + 1);
        setStage(0);
      } else {
        setStage(stage + 1);
      }
    }, current.duration);
    return () => window.clearTimeout(timer);
  }, [stage, playing, inView, reduce]);

  useEffect(() => {
    if (!inView || sealStarted.current) return;
    sealStarted.current = true;
    const run = () => {
      sealInBrowser(
        originalEmail,
        reviewers.map((reviewer) => reviewer.name),
      )
        .then((result) => {
          setSeal(result);
          setStatus(result.verified ? "live" : "fallback");
        })
        .catch(() => setStatus("fallback"));
    };
    const idle = window.requestIdleCallback as Window["requestIdleCallback"] | undefined;
    if (idle) window.requestIdleCallback(run, { timeout: 2500 });
    else window.setTimeout(run, 800);
  }, [inView]);

  function choose(index: number) {
    setPlaying(false);
    if (index === stage) return;
    if (index < stage) setCycle((value) => value + 1);
    setStage(index);
  }

  function togglePlaying() {
    setPlaying((value) => !value);
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <div
        className="overflow-hidden rounded-xl bg-bg text-ink motion-reduce:hidden"
        role="group"
        aria-label="Demonstration: one email passing through Candor's privacy steps"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <p className="text-sm font-semibold">One email, start to finish</p>
            <StatusChip status={status} />
          </div>
          <button
            type="button"
            onClick={togglePlaying}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
            aria-label={playing ? "Pause demonstration" : "Play demonstration"}
          >
            {playing ? (
              <Pause className="size-3.5" aria-hidden="true" />
            ) : (
              <Play className="size-3.5" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">{playing ? "Pause" : "Play"}</span>
          </button>
        </div>

        <ol className="grid grid-cols-4 border-b border-line" aria-label="Steps">
          {stages.map((item, index) => (
            <li key={item.label} className="min-w-0">
              <button
                type="button"
                onClick={() => choose(index)}
                aria-current={index === stage ? "step" : undefined}
                className={cn(
                  "group relative flex h-11 w-full cursor-pointer items-center justify-center gap-1.5 px-1 text-xs transition-colors duration-150 sm:text-sm",
                  index === stage ? "font-medium text-ink" : "text-ink-2 hover:text-ink",
                )}
              >
                <span className="tabular font-mono text-2xs text-ink-3">{index + 1}</span>
                <span className="truncate">{item.label}</span>
                <span className="absolute inset-x-2 bottom-0 h-0.5 overflow-hidden rounded-full bg-surface-3">
                  <StepProgress
                    key={`${cycle}-${index}-${stage}-${playing}-${inView}`}
                    state={index < stage ? "done" : index > stage ? "todo" : "active"}
                    running={playing && inView && !reduce}
                    duration={item.duration}
                  />
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div className="grid px-4 pt-4 pb-5 sm:px-5 sm:pt-5">
          <Layer active={stage <= 1}>
            <EmailView key={cycle} replaced={stage >= 1} />
          </Layer>
          <Layer active={stage === 2}>
            <CipherView active={stage === 2} seal={seal} />
          </Layer>
          <Layer active={stage === 3}>
            <SplitView active={stage === 3} seal={seal} status={status} />
          </Layer>
        </div>

        <div className="grid border-t border-line bg-surface px-4 py-3.5 sm:px-5">
          {captions.map((caption, index) => (
            <Layer key={caption.title} active={index === stage} lift={false}>
              <p className="text-sm font-medium text-ink">{caption.title}</p>
              <p className="mt-0.5 text-sm text-ink-2">{caption.body}</p>
            </Layer>
          ))}
        </div>
      </div>

      <Storyboard seal={seal} status={status} />
    </div>
  );
}

const captions = [
  {
    title: "Found on your device",
    body: `${piiSummary.total} identifiers: ${piiSummary.personMentions} mentions of ${piiSummary.distinctPeople} people, ${piiSummary.orgs} organisation, ${piiSummary.emails} email address. Nothing has been uploaded.`,
  },
  {
    title: "Replaced with consistent placeholders",
    body: "Dana Whitfield and Dana both become PERSON_1, in every file. The analysis model only ever sees placeholders.",
  },
  {
    title: "Sealed before upload",
    body: "XChaCha20-Poly1305 under a fresh report key. Padmé padding hides the exact length. The server stores only this.",
  },
  {
    title: "Key split between three reviewers",
    body: "Any two reviewers can open the report together, and the opening is logged publicly. One share alone reveals nothing.",
  },
];

function Layer({
  active,
  lift = true,
  children,
}: {
  active: boolean;
  lift?: boolean;
  children: ReactNode;
}) {
  return (
    <motion.div
      className={cn("min-w-0 [grid-area:1/1]", !active && "pointer-events-none")}
      initial={false}
      animate={{ opacity: active ? 1 : 0, y: lift && !active ? 6 : 0 }}
      transition={{ duration: active ? 0.5 : 0.25, ease: easeOutExpo, delay: active ? 0.12 : 0 }}
      aria-hidden={!active}
    >
      {children}
    </motion.div>
  );
}

function StepProgress({
  state,
  running,
  duration,
}: {
  state: "done" | "active" | "todo";
  running: boolean;
  duration: number;
}) {
  if (state === "todo") return null;
  if (state === "done" || !running)
    return (
      <span
        className={cn("block h-full w-full", state === "done" ? "bg-ink-3" : "bg-seal")}
        aria-hidden="true"
      />
    );
  return (
    <motion.span
      className="block h-full w-full origin-left bg-seal"
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{ duration: duration / 1000, ease: "linear" }}
      aria-hidden="true"
    />
  );
}

function StatusChip({ status }: { status: SealStatus }) {
  const label =
    status === "live"
      ? "Real crypto, in this tab"
      : status === "pending"
        ? "Generating keys"
        : "Illustrative bytes";
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-2xs font-medium whitespace-nowrap",
        status === "live" ? "bg-documented-soft text-documented" : "bg-surface-2 text-ink-2",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "live" ? "bg-documented" : "bg-ink-3",
          status === "pending" && "animate-pulse",
        )}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function EmailView({ replaced }: { replaced: boolean }) {
  return (
    <p className="text-sm leading-6 break-words whitespace-pre-wrap text-ink sm:text-[0.9375rem] sm:leading-7">
      {emailSegments.map((segment, index) =>
        segment.kind === "text" ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <PiiToken
            key={index}
            text={segment.text}
            placeholder={segment.placeholder}
            order={piiOrder[index] ?? 0}
            replaced={replaced}
          />
        ),
      )}
    </p>
  );
}

function PiiToken({
  text,
  placeholder,
  order,
  replaced,
}: {
  text: string;
  placeholder: string;
  order: number;
  replaced: boolean;
}) {
  return (
    <span className="relative inline-block whitespace-nowrap">
      <AnimatePresence mode="popLayout">
        {replaced ? (
          <motion.span
            key="placeholder"
            className="inline-block rounded-xs bg-surface-3 px-1 font-mono text-[0.86em] font-medium text-ink"
            initial={{ opacity: 0, y: 5, filter: "blur(3px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{ duration: 0.55, ease: easeOutExpo, delay: 0.25 + order * 0.16 }}
          >
            {placeholder}
          </motion.span>
        ) : (
          <motion.span
            key="name"
            className="relative inline-block"
            exit={{
              opacity: 0,
              y: -5,
              filter: "blur(3px)",
              transition: { duration: 0.3, ease: easeOutQuart, delay: 0.1 + order * 0.16 },
            }}
          >
            <motion.span
              className="absolute -inset-x-0.5 inset-y-0.5 origin-left rounded-xs bg-seal-soft"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.6, ease: easeOutExpo, delay: 0.55 + order * 0.24 }}
              aria-hidden="true"
            />
            <motion.span
              className="absolute -inset-x-0.5 bottom-0.5 h-0.5 origin-left rounded-full bg-seal"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.6, ease: easeOutExpo, delay: 0.6 + order * 0.24 }}
              aria-hidden="true"
            />
            <span className="relative">{text}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function CipherView({ active, seal }: { active: boolean; seal: SealResult }) {
  const total = seal.ciphertext.length;
  const progress = useMotionValue(0);
  const [count, setCount] = useState(0);

  useMotionValueEvent(progress, "change", (value) => setCount(Math.round(value)));

  useEffect(() => {
    if (!active) {
      progress.jump(0);
      setCount(0);
      return;
    }
    progress.jump(0);
    const controls = animate(progress, total, { duration: 1.9, ease: easeOutQuart, delay: 0.2 });
    return () => controls.stop();
  }, [active, total, progress]);

  const frontier = active && count < total ? Math.min(12, total - count) : 0;
  const scrambled = Array.from({ length: frontier }, randomB64uChar).join("");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 font-mono text-2xs text-ink-2">
        <span>
          CandorBox · <span className="text-ink">xc20p-padme</span>
        </span>
        <span className="truncate">nonce {truncateMiddle(seal.nonce, 6, 4)}</span>
      </div>
      <p
        className="font-mono text-xs leading-5 break-all text-ink-2 sm:text-[0.8125rem] sm:leading-[1.375rem]"
        aria-label={`Ciphertext, ${total} base64url characters`}
      >
        <span>{seal.ciphertext.slice(0, count)}</span>
        <span className="text-seal-ink">{scrambled}</span>
        <span className="text-transparent">{seal.ciphertext.slice(count + frontier)}</span>
      </p>
      <ByteMath />
    </div>
  );
}

function ByteMath({ className }: { className?: string }) {
  const steps = [
    { label: "Email", value: emailSizes.plain },
    { label: "Framed", value: emailSizes.framed },
    { label: "Padmé", value: emailSizes.padded },
    { label: "Sealed", value: emailSizes.sealed },
  ];
  return (
    <dl className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs", className)}>
      {steps.map((step, index) => (
        <div key={step.label} className="flex items-center gap-1.5">
          {index > 0 ? <ArrowRight className="size-3 text-ink-3" aria-hidden="true" /> : null}
          <div className="flex items-baseline gap-1 rounded-sm bg-surface-2 px-1.5 py-0.5">
            <dt className="text-ink-2">{step.label}</dt>
            <dd className="tabular font-mono font-medium text-ink">{step.value} B</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

function SplitView({
  active,
  seal,
  status,
}: {
  active: boolean;
  seal: SealResult;
  status: SealStatus;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-sm bg-surface-2 px-2 py-1 font-mono text-2xs text-ink-2">
          <Lock className="size-3" aria-hidden="true" />
          ciphertext · {emailSizes.sealed} B
        </span>
        <span className="text-2xs text-ink-2">Shamir 2-of-3 over GF(256)</span>
      </div>
      <div className="mt-4 flex justify-center">
        <motion.span
          className="inline-flex items-center gap-2 rounded-md bg-ink px-3 py-1.5 font-mono text-xs text-bg"
          initial={false}
          animate={{ scale: active ? 1 : 0.92, opacity: active ? 1 : 0 }}
          transition={{ duration: 0.5, ease: easeOutExpo }}
        >
          K_r
          <span className="text-bg/70">{truncateMiddle(seal.keyHex, 6, 4)}</span>
        </motion.span>
      </div>
      <svg viewBox="0 0 300 36" className="block h-auto w-full" aria-hidden="true" fill="none">
        {[49, 150, 251].map((x, index) => (
          <motion.path
            key={x}
            d={`M150 2 C150 20 ${x} 16 ${x} 34`}
            className="stroke-ink-3"
            strokeWidth={1.25}
            strokeLinecap="round"
            initial={false}
            animate={{ pathLength: active ? 1 : 0, opacity: active ? 1 : 0 }}
            transition={{
              duration: active ? 0.8 : 0.2,
              ease: easeOutExpo,
              delay: active ? 0.3 + index * 0.12 : 0,
            }}
          />
        ))}
      </svg>
      <ul className="grid grid-cols-3 gap-2">
        {seal.shares.map((share, index) => (
          <motion.li
            key={share.reviewer}
            className="min-w-0 rounded-lg bg-surface px-2 py-2 sm:px-2.5"
            initial={false}
            animate={{ opacity: active ? 1 : 0, y: active ? 0 : 8 }}
            transition={{
              duration: 0.6,
              ease: easeOutExpo,
              delay: active ? 0.55 + index * 0.12 : 0,
            }}
          >
            <p className="tabular text-2xs text-ink-2">Share {index + 1}</p>
            <p className="truncate text-sm font-medium text-ink">{share.reviewer}</p>
            <p className="mt-1 truncate font-mono text-2xs text-ink-2" title={share.sealed}>
              {share.sealed}
            </p>
            <p className="mt-0.5 truncate font-mono text-2xs text-ink-3">
              to {share.keyId.slice(0, 8)}
            </p>
          </motion.li>
        ))}
      </ul>
      <motion.div
        className="mt-3 flex flex-col gap-1.5"
        initial={false}
        animate={{ opacity: active ? 1 : 0 }}
        transition={{ duration: 0.5, delay: active ? 1.1 : 0 }}
      >
        <ThresholdLine />
        <VerifiedLine status={status} />
      </motion.div>
    </div>
  );
}

function ThresholdLine() {
  return (
    <p className="flex items-center gap-2 text-xs text-ink-2">
      <span className="flex gap-1" aria-hidden="true">
        <span className="size-2 rounded-full bg-seal" />
        <span className="size-2 rounded-full bg-seal" />
        <span className="size-2 rounded-full border border-line-strong" />
      </span>
      Any 2 of 3 rebuild K_r. One alone learns nothing.
    </p>
  );
}

function VerifiedLine({ status }: { status: SealStatus }) {
  if (status === "live")
    return (
      <p className="flex items-start gap-2 text-xs text-ink-2">
        <Check className="mt-0.5 size-3.5 shrink-0 text-documented" aria-hidden="true" />
        Checked in this tab: shares 1 and 3 were unsealed, rebuilt K_r and decrypted the email.
      </p>
    );
  if (status === "pending")
    return <p className="text-xs text-ink-3">Generating real keys in this tab…</p>;
  return (
    <p className="text-xs text-ink-3">
      Illustrative values with real lengths. The crypto library did not load here.
    </p>
  );
}

function StaticEmail({ replaced }: { replaced: boolean }) {
  return (
    <p className="text-sm leading-6 break-words whitespace-pre-wrap text-ink">
      {emailSegments.map((segment, index) =>
        segment.kind === "text" ? (
          <span key={index}>{segment.text}</span>
        ) : replaced ? (
          <span
            key={index}
            className="rounded-xs bg-surface-3 px-1 font-mono text-[0.86em] font-medium"
          >
            {segment.placeholder}
          </span>
        ) : (
          <mark
            key={index}
            className="rounded-xs bg-seal-soft px-0.5 text-ink underline decoration-seal decoration-2 underline-offset-4"
          >
            {segment.text}
          </mark>
        ),
      )}
    </p>
  );
}

function Storyboard({ seal, status }: { seal: SealResult; status: SealStatus }) {
  return (
    <ol
      className="hidden divide-y divide-line overflow-hidden rounded-xl bg-bg text-ink motion-reduce:block"
      aria-label="How one email passes through Candor"
    >
      <StoryStep index={1} title="Detect, on your device" body={captions[0]?.body ?? ""}>
        <StaticEmail replaced={false} />
      </StoryStep>
      <StoryStep index={2} title="Replace with placeholders" body={captions[1]?.body ?? ""}>
        <StaticEmail replaced />
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {nameMap.slice(0, 4).map((entry) => (
            <li key={entry.placeholder}>
              <span className="font-mono text-ink">{entry.placeholder}</span> = {entry.value}
            </li>
          ))}
        </ul>
      </StoryStep>
      <StoryStep index={3} title="Seal before upload" body={captions[2]?.body ?? ""}>
        <p className="line-clamp-3 font-mono text-xs leading-5 break-all text-ink-2">
          {seal.ciphertext}
        </p>
        <ByteMath className="mt-3" />
      </StoryStep>
      <StoryStep index={4} title="Split the key 2-of-3" body={captions[3]?.body ?? ""}>
        <ul className="grid grid-cols-3 gap-2">
          {seal.shares.map((share, index) => (
            <li key={share.reviewer} className="min-w-0 rounded-lg bg-surface px-2 py-2">
              <p className="text-2xs text-ink-2">Share {index + 1}</p>
              <p className="truncate text-sm font-medium">{share.reviewer}</p>
              <p className="truncate font-mono text-2xs text-ink-2">{share.sealed}</p>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-col gap-1.5">
          <ThresholdLine />
          <VerifiedLine status={status} />
        </div>
      </StoryStep>
    </ol>
  );
}

function StoryStep({
  index,
  title,
  body,
  children,
}: {
  index: number;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <li className="px-4 py-4 sm:px-5">
      <p className="flex items-baseline gap-2 text-sm font-semibold">
        <span className="tabular font-mono text-xs text-ink-3">{index}</span>
        {title}
      </p>
      <div className="mt-2.5">{children}</div>
      <p className="mt-2.5 text-sm text-ink-2">{body}</p>
    </li>
  );
}
