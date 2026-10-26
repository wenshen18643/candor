import { Children, type ReactNode } from "react";

import { Disclosure } from "@/components/ui/disclosure";
import { cn } from "@/lib/cn";

export function ArchSection({
  id,
  title,
  summary,
  lead,
  sources,
  showFirst = true,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  lead: ReactNode;
  sources: string[];
  showFirst?: boolean;
  children: ReactNode;
}) {
  const items = Children.toArray(children);
  const shown = showFirst ? items.slice(0, 1) : [];
  const hidden = showFirst ? items.slice(1) : items;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-6 border-t border-line pt-12 first:border-t-0 first:pt-0"
    >
      <h2 id={`${id}-title`} className="text-2xl font-semibold tracking-[-0.02em]">
        {title}
      </h2>
      <p className="mt-2 max-w-[56ch] text-md text-ink-2">{summary}</p>
      {shown.length ? <div className="mt-8">{shown}</div> : null}
      <Disclosure summary="Details" className="mt-6" bodyClassName="flex flex-col gap-10 py-6">
        <p className="max-w-[68ch] text-base text-ink-2">{lead}</p>
        {hidden}
        <Sources paths={sources} />
      </Disclosure>
    </section>
  );
}

export function Sources({ paths }: { paths: string[] }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:gap-4">
      <p className="shrink-0 text-xs font-medium text-ink-2">Implemented in</p>
      <ul className="flex flex-wrap gap-1.5">
        {paths.map((path) => (
          <li key={path}>
            <code className="inline-block rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-2xs break-all text-ink-2">
              {path}
            </code>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-lg font-semibold">{children}</h3>;
}

export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex max-w-[68ch] flex-col gap-3 text-base leading-[1.65] text-ink-2 [&_strong]:font-semibold [&_strong]:text-ink",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function C({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-xs bg-surface-2 px-1 py-px font-mono text-[0.86em] break-words text-ink">
      {children}
    </code>
  );
}

export function CodeBlock({ children, label }: { children: string; label: string }) {
  return (
    <pre
      aria-label={label}
      tabIndex={0}
      className="scrollbar-quiet overflow-x-auto rounded-lg bg-surface-2 px-4 py-3.5 font-mono text-xs leading-5 text-ink"
    >
      <code>{children}</code>
    </pre>
  );
}

export function FactList({
  items,
  className,
}: {
  items: { term: ReactNode; detail: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("flex flex-col divide-y divide-line border-y border-line", className)}>
      {items.map((item, index) => (
        <div
          key={index}
          className="grid gap-x-6 gap-y-1 py-3.5 text-base sm:grid-cols-[13rem_minmax(0,1fr)]"
        >
          <dt className="font-medium text-ink">{item.term}</dt>
          <dd className="text-ink-2">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="flex max-w-[68ch] flex-col gap-3">
      {items.map((item, index) => (
        <li key={index} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 text-base">
          <span
            className="tabular mt-px flex size-6 items-center justify-center rounded-full bg-surface-3 font-mono text-xs text-ink-2"
            aria-hidden="true"
          >
            {index + 1}
          </span>
          <span className="text-ink-2 [&_strong]:font-semibold [&_strong]:text-ink">{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function Figure({
  visual,
  alternative,
  caption,
  mode = "swap",
}: {
  visual: ReactNode;
  alternative: ReactNode;
  caption: ReactNode;
  mode?: "swap" | "always";
}) {
  return (
    <figure className="flex flex-col gap-3">
      <div className={cn("rounded-xl bg-surface p-4 sm:p-6", mode === "swap" && "hidden md:block")}>
        {visual}
      </div>
      {mode === "swap" ? (
        <Disclosure summary="Show the diagram as text" className="md:hidden">
          {alternative}
          <p className="mt-4 text-sm text-ink-3">{caption}</p>
        </Disclosure>
      ) : null}
      <figcaption
        className={cn("max-w-[68ch] text-sm text-ink-2", mode === "swap" && "hidden md:block")}
      >
        {caption}
      </figcaption>
      <details className={cn("group", mode === "swap" && "hidden md:block")}>
        <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-xs text-sm font-medium text-ink-2 hover:text-ink">
          Read this diagram as text
        </summary>
        <div className="mt-3 rounded-lg border border-line p-4">{alternative}</div>
      </details>
    </figure>
  );
}

export function WideVisual({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      className="scrollbar-quiet -mx-1 overflow-x-auto px-1 md:mx-0 md:overflow-visible md:px-0"
      data-label={label}
    >
      <div className="min-w-[38rem] md:min-w-0">{children}</div>
    </div>
  );
}

export type TableRow = { key: string; head: ReactNode; cells: ReactNode[] };

export function ResponsiveTable({
  caption,
  columns,
  rows,
  emphasizeLast = false,
}: {
  caption: string;
  columns: string[];
  rows: TableRow[];
  emphasizeLast?: boolean;
}) {
  const [first, ...rest] = columns;
  return (
    <>
      <table className="hidden w-full border-collapse text-left text-sm md:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line-strong text-xs text-ink-2">
            {columns.map((column) => (
              <th key={column} scope="col" className="py-2.5 pr-4 font-medium last:pr-0">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-line align-top">
              <th scope="row" className="py-3 pr-4 font-semibold text-ink">
                {row.head}
              </th>
              {row.cells.map((cell, index) => (
                <td
                  key={index}
                  className={cn(
                    "py-3 pr-4 last:pr-0",
                    emphasizeLast && index === row.cells.length - 1 ? "text-ink" : "text-ink-2",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul
        aria-label={caption}
        className="flex flex-col divide-y divide-line border-y border-line md:hidden"
      >
        {rows.map((row) => (
          <li key={row.key} className="py-3.5">
            <p className="text-base font-semibold text-ink">
              <span className="sr-only">{first}: </span>
              {row.head}
            </p>
            <dl className="mt-1.5 flex flex-col gap-1.5 text-sm">
              {row.cells.map((cell, index) => (
                <div key={index}>
                  <dt className="text-xs font-medium text-ink-3">{rest[index]}</dt>
                  <dd
                    className={
                      emphasizeLast && index === row.cells.length - 1 ? "text-ink" : "text-ink-2"
                    }
                  >
                    {cell}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
