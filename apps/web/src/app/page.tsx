import { Hero } from "@/components/landing/hero";
import { Measured } from "@/components/landing/measured";
import { Mechanisms } from "@/components/landing/mechanisms";
import { PipelineSection } from "@/components/landing/pipeline-section";
import { SiteFooter } from "@/components/landing/site-footer";
import { VisibilityMatrix } from "@/components/landing/visibility-matrix";
import { SiteHeader } from "@/components/shell/site-header";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <VisibilityMatrix />
        <PipelineSection />
        <Mechanisms />
        <Measured />
      </main>
      <SiteFooter />
    </>
  );
}
