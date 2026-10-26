import type { Metadata } from "next";

import { EvalsView } from "@/components/evals/evals-view";
import { SiteHeader } from "@/components/shell/site-header";

export const metadata: Metadata = {
  title: "Evaluation",
  description:
    "Candor's synthetic evaluation: identifier leakage, source traceability, timeline accuracy, invalid-output handling, injection robustness and the model benchmark.",
};

export default function EvalsPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <EvalsView />
      </main>
    </>
  );
}
