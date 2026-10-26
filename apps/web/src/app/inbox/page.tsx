import type { Metadata } from "next";

import { InboxView } from "@/components/inbox/inbox-view";
import { SiteHeader } from "@/components/shell/site-header";

export const metadata: Metadata = {
  title: "Check replies",
  description: "Open your anonymous inbox with your 8-word codename and reply to the review team.",
};

export default function InboxPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-[640px] px-5 pt-8 pb-24 sm:pt-12">
        <InboxView />
      </main>
    </>
  );
}
