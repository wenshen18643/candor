"use client";

import { DoorOpen, Info, KeyRound, ShieldOff } from "lucide-react";
import { type FormEvent, type ReactNode, type RefObject, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { countCodenameWords } from "@/lib/inbox-client";

export function CodenameForm({
  demoCodename,
  error,
  inputRef,
  onSubmit,
}: {
  demoCodename: string | null;
  error: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSubmit: (codename: string) => void;
}) {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const words = countCodenameWords(value);
  const wrongCount = touched && words !== 8;
  const message = wrongCount ? `Your codename has 8 words. You typed ${words}.` : error;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    setTouched(true);
    if (countCodenameWords(value) !== 8) {
      inputRef.current?.focus();
      return;
    }
    onSubmit(value);
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Check for replies</h1>
        <p className="text-md text-ink-2">Type your eight secret words.</p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="codename" className="text-base font-medium text-ink">
              Your codename
            </label>
            <span
              className={cn("tabular text-sm", words === 8 ? "text-documented" : "text-ink-2")}
              aria-live="polite"
            >
              {words} of 8 words
            </span>
          </div>
          <textarea
            id="codename"
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={2}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="word-word-word-word-word-word-word-word"
            aria-invalid={message ? true : undefined}
            aria-describedby="codename-help"
            className="w-full resize-none rounded-lg border border-line-strong bg-bg px-3.5 py-3 font-mono text-md leading-7 text-ink transition-colors duration-150 placeholder:text-ink-3 hover:border-ink-3 focus-visible:border-seal focus-visible:ring-2 focus-visible:ring-seal/25 focus-visible:outline-none aria-[invalid=true]:border-contradicted"
          />
          <p
            id="codename-help"
            className={cn("text-sm", message ? "text-contradicted" : "text-ink-2")}
            role={message ? "alert" : undefined}
          >
            {message ?? "Spaces or dashes both work."}
          </p>
        </div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full sm:w-auto sm:self-start"
        >
          <DoorOpen aria-hidden="true" />
          Open my inbox
        </Button>
      </form>

      {demoCodename ? (
        <div className="flex flex-col gap-3 rounded-lg bg-surface px-4 py-4">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <Info className="size-4 text-ink-2" aria-hidden="true" />
            Trying Candor? Use the demo codename.
          </p>
          <p className="font-mono text-sm break-words text-ink-2">
            {demoCodename.split("-").join(" ")}
          </p>
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              setValue(demoCodename.split("-").join(" "));
              setTouched(false);
              inputRef.current?.focus();
            }}
          >
            Try the demo codename
          </Button>
        </div>
      ) : null}

      <ul className="flex flex-col gap-5" aria-label="How your inbox stays private">
        <Point icon={KeyRound} title="Your codename is the only key.">
          We never see it or keep a copy.
        </Point>
        <Point icon={ShieldOff} title="It can't be recovered.">
          Lose it and nobody can open this inbox, us included.
        </Point>
        <Point icon={DoorOpen} title="Nothing is saved here.">
          Closing this tab locks it again.
        </Point>
      </ul>
    </div>
  );
}

function Point({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof KeyRound;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-3">
      <Icon className="mt-0.5 size-5 text-ink-2" aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-medium text-ink">{title}</span>
        <span className="text-base text-ink-2">{children}</span>
      </div>
    </li>
  );
}
