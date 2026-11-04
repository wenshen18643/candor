import { showcaseReportIds } from "@/lib/console/showcase";

import { ReportView } from "./report-view";

export function generateStaticParams() {
  return showcaseReportIds.map((id) => ({ id }));
}

export default function ReportPage() {
  return <ReportView />;
}
