import { ClaimCheck } from "@/components/landing/claim-check";
import { Hero } from "@/components/landing/hero";
import { SiteFooter } from "@/components/landing/site-footer";
import { Steps } from "@/components/landing/steps";
import { SiteHeader } from "@/components/shell/site-header";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <Steps />
        <ClaimCheck />
      </main>
      <SiteFooter />
    </>
  );
}
