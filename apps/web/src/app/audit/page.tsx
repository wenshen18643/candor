import type { Metadata } from "next";

import { AuditView } from "@/components/audit/audit-view";
import { SiteHeader } from "@/components/shell/site-header";

export const metadata: Metadata = {
  title: "Transparency log",
  description:
    "Verify Candor's RFC 9162 transparency log in your browser: signed tree heads, inclusion proofs, consistency proofs and anchors.",
};

export default function AuditPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <AuditView />
      </main>
    </>
  );
}
