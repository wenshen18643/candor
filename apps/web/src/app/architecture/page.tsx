import type { Metadata } from "next";

import {
  InjectionSection,
  PipelineArchSection,
  TransparencySection,
} from "@/components/architecture/sections-analysis";
import {
  EvaluationSection,
  InfrastructureSection,
  PaymentsSection,
  ThreatSection,
} from "@/components/architecture/sections-operate";
import {
  CustodySection,
  DeviceSection,
  IdentitySection,
  TrustSection,
} from "@/components/architecture/sections-protect";
import { Toc, type TocItem } from "@/components/architecture/toc";
import { emailSizes } from "@/components/landing/demo-data";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/shell/site-header";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Candor's architecture: trust domains, blind-token identity, on-device redaction, threshold custody, the twelve-stage analysis pipeline, the transparency log, x402 payments and the threat model.",
};

const sections: TocItem[] = [
  { id: "trust-domains", label: "Trust domains" },
  { id: "identity", label: "Identity flow" },
  { id: "on-device", label: "On-device privacy" },
  { id: "custody", label: "Encryption and custody" },
  { id: "pipeline", label: "Analysis pipeline" },
  { id: "injection", label: "Prompt injection" },
  { id: "transparency", label: "Transparency log" },
  { id: "payments", label: "Payments" },
  { id: "infrastructure", label: "Infrastructure" },
  { id: "evaluation", label: "Evaluation" },
  { id: "threats", label: "Threat model" },
];

export default function ArchitecturePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1200px] px-5 sm:px-8">
        <header className="max-w-[68ch] pt-10 pb-12 sm:pt-16 sm:pb-16">
          <h1 className="text-[clamp(2rem,1.5rem+2vw,2.75rem)] leading-[1.1] font-semibold tracking-[-0.025em]">
            How Candor works
          </h1>
          <p className="mt-4 text-lg text-ink-2">
            The system as built: five trust domains, the protocols between them, a twelve-stage
            analysis pipeline, and the risks that remain. Every section names the files that
            implement it.
          </p>
          <p className="mt-4 text-sm text-ink-3">
            The specs in <code className="font-mono text-ink-2">docs/specs</code> are the contract
            between services; where code and spec disagree, the spec wins.
          </p>
        </header>
        <div className="grid gap-10 pb-24 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
          <aside className="lg:row-span-1">
            <Toc items={sections} />
          </aside>
          <div className="flex min-w-0 flex-col gap-16">
            <TrustSection />
            <IdentitySection />
            <DeviceSection />
            <CustodySection padme={emailSizes} />
            <PipelineArchSection />
            <InjectionSection />
            <TransparencySection />
            <PaymentsSection />
            <InfrastructureSection />
            <EvaluationSection />
            <ThreatSection />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
