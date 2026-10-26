"use client";

import { FileText, FolderOpen, Plus, Upload, X } from "lucide-react";
import { type DragEvent, type KeyboardEvent, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { analyseText, hasText, processFiles } from "@/lib/reporter/engine";
import { useReporter } from "@/lib/reporter/store";

import { formatBytes, SectionTitle, StepActions, StepHeading } from "./parts";

const maxFiles = 12;
const maxBytes = 25 * 1024 * 1024;
const accept = ".pdf,.docx,.eml,.txt,.md,.csv,.json,.jpg,.jpeg,.png,.heic,.webp";

type SampleManifest = {
  title: string;
  statement: string;
  selfTerms: string[];
  files: { name: string; type: string }[];
};

function TermInput({ terms, onChange }: { terms: string[]; onChange: (terms: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const id = useId();

  function commit() {
    const value = draft.trim();
    if (value.length < 2 || terms.some((term) => term.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...terms, value]);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Backspace" && draft.length === 0 && terms.length > 0)
      onChange(terms.slice(0, -1));
  }

  return (
    <Field
      htmlFor={id}
      label="Words that could identify you"
      hint="Your name, email, phone, staff ID or team. Always removed, and never leave this device."
    >
      <div className="flex flex-wrap gap-1.5 rounded-md border border-line-strong bg-bg p-1.5 focus-within:border-seal focus-within:ring-2 focus-within:ring-seal/25">
        {terms.map((term) => (
          <span
            key={term}
            className="inline-flex h-7 items-center gap-1 rounded-full bg-seal-soft pr-1 pl-2.5 text-sm text-seal-ink"
          >
            {term}
            <button
              type="button"
              onClick={() => onChange(terms.filter((item) => item !== term))}
              className="flex size-5 cursor-pointer items-center justify-center rounded-full hover:bg-seal/15"
              aria-label={`Remove ${term}`}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <div className="flex min-w-[180px] flex-1 items-center gap-1">
          <Input
            id={id}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commit}
            placeholder={terms.length ? "Add another" : "Type and press Enter"}
            className="h-7 border-0 px-1.5 focus-visible:ring-0"
            autoComplete="off"
            spellCheck={false}
          />
          {draft.trim().length >= 2 ? (
            <Button size="sm" variant="quiet" onClick={commit} type="button">
              <Plus aria-hidden="true" />
              Add
            </Button>
          ) : null}
        </div>
      </div>
    </Field>
  );
}

export function StepEvidence() {
  const { statement, selfTerms, rawFiles, patch, setStep } = useReporter();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const statementId = useId();

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    const tooLarge = incoming.find((file) => file.size > maxBytes);
    if (tooLarge) {
      setError(`${tooLarge.name} is larger than 25 MB.`);
      return;
    }
    const merged = [...rawFiles];
    for (const file of incoming)
      if (!merged.some((item) => item.name === file.name && item.size === file.size))
        merged.push(file);
    if (merged.length > maxFiles) {
      setError(`You can attach up to ${maxFiles} files.`);
      return;
    }
    setError(null);
    patch({ rawFiles: merged });
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  }

  async function loadSample() {
    setBusy(true);
    setError(null);
    try {
      const base = "/samples/procurement-kickback";
      const manifest = (await (await fetch(`${base}/manifest.json`)).json()) as SampleManifest;
      const files = await Promise.all(
        manifest.files.map(async (item) => {
          const blob = await (await fetch(`${base}/${item.name}`)).blob();
          return new File([blob], item.name, { type: item.type });
        }),
      );
      patch({ statement: manifest.statement, selfTerms: manifest.selfTerms, rawFiles: files });
      setSample(manifest.title);
    } catch {
      setError("Couldn't load the sample evidence.");
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    setBusy(true);
    setError(null);
    try {
      const files = await processFiles(rawFiles);
      const { docs, detections } = await analyseText(files, statement, selfTerms);
      patch({
        files,
        docs,
        detections,
        decisions: {},
        variants: files.map((file) => (hasText(file) ? "redacted" : "original")),
        scrubbed: null,
        leakage: null,
      });
      setStep("review");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `We couldn't read one of your files: ${cause.message}`
          : "We couldn't read one of your files.",
      );
    } finally {
      setBusy(false);
    }
  }

  const ready = statement.trim().length >= 40;

  return (
    <section>
      <StepHeading title="Tell us what happened">
        <p>Use your own words. You&apos;ll check everything before it&apos;s sent.</p>
      </StepHeading>

      <div className="flex flex-col gap-8">
        <Field
          htmlFor={statementId}
          label="What happened?"
          hint={
            ready
              ? "Dates, places and who was involved help most."
              : "At least 40 characters. Dates and places help most."
          }
        >
          <Textarea
            id={statementId}
            value={statement}
            onChange={(event) => patch({ statement: event.target.value })}
            className="min-h-44 text-md leading-7"
            placeholder="For example: On 4 March, my manager asked me to approve an invoice for work that was never delivered…"
          />
        </Field>

        <div>
          <SectionTitle
            aside={
              <Button variant="link" size="sm" onClick={loadSample} disabled={busy}>
                <FolderOpen aria-hidden="true" />
                Use sample evidence
              </Button>
            }
          >
            Files
          </SectionTitle>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors duration-150",
              dragging ? "border-seal bg-seal-soft" : "border-line-strong bg-surface",
            )}
          >
            <Upload className="size-5 text-ink-3" aria-hidden="true" />
            <p className="text-base text-ink-2">
              Drop files here or{" "}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="cursor-pointer font-medium text-seal-ink underline-offset-4 hover:underline"
              >
                choose files
              </button>
            </p>
            <p className="text-sm text-ink-3">
              PDF, Word, email, text or photos. Up to 25 MB each.
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={accept}
              className="sr-only"
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
          {sample ? (
            <p className="mt-2 text-sm text-ink-2">
              Loaded <span className="font-medium text-ink">{sample}</span>. Everyone in it is made
              up.
            </p>
          ) : null}
          {rawFiles.length ? (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
              {rawFiles.map((file) => (
                <li
                  key={`${file.name}-${file.size}`}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <FileText className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-base">{file.name}</span>
                  <span className="text-sm text-ink-3 tabular-nums">{formatBytes(file.size)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => patch({ rawFiles: rawFiles.filter((item) => item !== file) })}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <TermInput terms={selfTerms} onChange={(terms) => patch({ selfTerms: terms })} />
      </div>

      {error ? (
        <p role="alert" className="mt-6 text-sm text-contradicted">
          {error}
        </p>
      ) : null}

      <StepActions>
        <Button variant="ghost" onClick={() => setStep("verify")}>
          Back
        </Button>
        <Button variant="primary" size="lg" disabled={!ready || busy} loading={busy} onClick={next}>
          {busy ? "Cleaning files on this device…" : "Clean and review"}
        </Button>
      </StepActions>
    </section>
  );
}
