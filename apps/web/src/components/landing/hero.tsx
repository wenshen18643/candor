import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { MechanismDemo } from "./mechanism-demo";

const heroFocus =
  "focus-visible:outline-on-seal dark:focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-2";

export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="bg-seal text-on-seal dark:bg-seal-soft dark:text-ink"
    >
      <div className="mx-auto grid w-full max-w-[1200px] items-center gap-12 px-5 pt-14 pb-16 sm:px-8 sm:pt-20 sm:pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:gap-16 lg:pt-24 lg:pb-24">
        <div className="min-w-0">
          <h1
            id="hero-title"
            className="text-[clamp(2.6rem,1.4rem+4.6vw,4.5rem)] leading-[1.02] font-bold tracking-[-0.03em]"
          >
            Say what happened.
            <span className="block text-seal-soft dark:text-seal-ink">Not who you are.</span>
          </h1>
          <p className="mt-6 max-w-[30rem] text-md sm:text-lg">
            Report wrongdoing without revealing yourself. Reviewers get a timeline where every line
            is checked against your evidence.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/report/northwind-ethics"
              className={`inline-flex h-12 items-center justify-center gap-2 rounded-md bg-on-seal px-5 text-md font-semibold text-seal-ink transition-colors duration-150 hover:bg-seal-soft dark:bg-seal dark:text-on-seal dark:hover:bg-seal-hover ${heroFocus}`}
            >
              Make a report
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="/console"
              className={`inline-flex h-12 items-center justify-center rounded-md border border-on-seal/55 px-5 text-md font-medium text-on-seal transition-colors duration-150 hover:bg-on-seal/10 dark:border-line-strong dark:text-ink dark:hover:bg-surface-3 ${heroFocus}`}
            >
              Open the reviewer console
            </Link>
          </div>
        </div>
        <MechanismDemo />
      </div>
    </section>
  );
}
