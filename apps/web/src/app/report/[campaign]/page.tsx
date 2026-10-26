import type { Metadata } from "next";

import { ReporterFlow } from "@/components/reporter/flow";

export const metadata: Metadata = {
  title: "Make a report",
  description: "Report wrongdoing without revealing who you are.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function ReportPage({ params }: { params: Promise<{ campaign: string }> }) {
  const { campaign } = await params;
  return <ReporterFlow campaignId={campaign} />;
}
