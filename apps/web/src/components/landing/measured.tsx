import { ArrowRight } from "lucide-react";
import Link from "next/link";

const measures: { name: string; how: string; bar?: string }[] = [
  {
    name: "Identifier leakage",
    how: "Planted canaries (the reporter’s name, email, phone, staff ID) are searched for in the analysis payload, every outbound prompt, the stripped file metadata and the final result.",
    bar: "Zero, on every surface.",
  },
  {
    name: "Grounding and recall",
    how: "Claims are matched to hand-written ground-truth events with Hungarian assignment. We report event recall, claim precision, quote grounding and citation precision.",
  },
  {
    name: "Timeline accuracy",
    how: "Kendall τ-b between true dates and predicted interval midpoints, mean error in days, interval coverage, and recall of planted contradictions.",
  },
  {
    name: "Broken model output",
    how: "The whole run is repeated with 30% of model responses corrupted: truncated JSON, missing fields, invented passage IDs.",
    bar: "Every final result schema-valid, and no invalid item reaches it.",
  },
  {
    name: "Prompt injection",
    how: "Scenarios carry planted instructions. We measure how many are flagged, whether any changes a claim or the brief, and whether true events are lost.",
  },
];

export function Measured() {
  return (
    <section aria-labelledby="measured-title" className="border-t border-line">
      <div className="mx-auto grid w-full max-w-[1200px] gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <div className="flex flex-col items-start">
          <h2 id="measured-title" className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
            Measured, not marketed
          </h2>
          <p className="mt-4 max-w-[52ch] text-md text-ink-2">
            The evaluation harness runs the real on-device scrubber and the real pipeline over six
            synthetic cases: procurement kickbacks, falsified safety inspections, a concealed data
            breach, fabricated research data, wage theft and retaliation. Every person in them is
            fictional.
          </p>
          <p className="mt-4 max-w-[52ch] text-md text-ink-2">
            Synthetic cases show the system behaves as designed. They are not a field study, and the
            numbers live on the evaluation page, from the latest recorded run, rather than on this
            one.
          </p>
          <div className="mt-8 flex flex-col gap-1">
            <Link
              href="/evals"
              className="group inline-flex items-center gap-2 rounded-xs text-md font-medium text-seal-ink"
            >
              See the latest evaluation run
              <ArrowRight
                className="size-4 transition-transform duration-200 ease-[var(--ease-out-quart)] group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
            <Link
              href="/architecture"
              className="group inline-flex items-center gap-2 rounded-xs text-md font-medium text-seal-ink"
            >
              Read the architecture, with its threat model
              <ArrowRight
                className="size-4 transition-transform duration-200 ease-[var(--ease-out-quart)] group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </div>
        </div>
        <dl className="flex flex-col divide-y divide-line border-y border-line">
          {measures.map((measure) => (
            <div
              key={measure.name}
              className="grid gap-x-6 gap-y-1.5 py-5 sm:grid-cols-[10rem_minmax(0,1fr)]"
            >
              <dt className="text-base font-semibold text-ink">{measure.name}</dt>
              <dd className="text-base text-ink-2">
                {measure.how}
                {measure.bar ? (
                  <span className="mt-1.5 block text-sm text-ink">
                    <span className="text-ink-2">Pass condition: </span>
                    {measure.bar}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
