"use client";

import { ArrowRight, CircleCheck, CircleDashed, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/field";
import { useConsole } from "@/lib/console/store";
import type { ReportSummary } from "@/lib/console/types";
import { formatDateTime, pluralize } from "@/lib/format";

const statusTone = {
  received: "info",
  triage: "seal",
  investigating: "allegation",
  closed: "neutral",
} as const;

function AnalysisCell({ report }: { report: ReportSummary }) {
  const { analysis } = report;
  if (analysis.status === "succeeded") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-documented">
        <CircleCheck className="size-4" aria-hidden="true" />
        Brief ready · {analysis.claims} claims
      </span>
    );
  }
  if (analysis.status === "queued" || analysis.status === "running") {
    return <span className="text-sm text-seal-ink">Running {analysis.stage ?? ""}</span>;
  }
  if (analysis.status === "failed" || analysis.status === "dead") {
    return <span className="text-sm text-contradicted">Analysis failed</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink-3">
      <CircleDashed className="size-4" aria-hidden="true" />
      Not analysed
    </span>
  );
}

function pendingHeadline({ analysis }: ReportSummary) {
  if (analysis.status === "queued" || analysis.status === "running")
    return "Sealed evidence. The brief appears here when analysis finishes.";
  if (analysis.status === "failed" || analysis.status === "dead")
    return "Sealed evidence. Analysis stopped before a brief was ready.";
  return "Sealed evidence, not yet analysed.";
}

export default function ReportsPage() {
  const { client } = useConsole();
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .listReports()
      .then(setReports)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "Could not load reports"),
      );
  }, [client]);

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.01em]">Reports</h1>
          <p className="mt-1 max-w-[64ch] text-base text-ink-2">
            Each report arrived as ciphertext with an unlinkable token. Times are rounded to the
            hour so arrival cannot be matched against office access logs.
          </p>
        </div>
      </header>

      {error ? (
        <p role="alert" className="mt-6 text-base text-contradicted">
          {error}
        </p>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-lg border border-line">
        <table className="w-full text-left">
          <thead className="bg-surface text-xs text-ink-2">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Report
              </th>
              <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">
                Received
              </th>
              <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">
                Analysis
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Status
              </th>
              <th scope="col" className="w-10 px-4 py-2.5">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {reports === null
              ? Array.from({ length: 3 }, (_, index) => (
                  <tr key={index} className="border-t border-line">
                    <td className="px-4 py-4" colSpan={5}>
                      <Skeleton className="h-10" />
                    </td>
                  </tr>
                ))
              : reports.map((report) => (
                  <tr
                    key={report.reportId}
                    className="group relative border-t border-line align-top hover:bg-surface"
                  >
                    <td className="px-4 py-4">
                      <Link
                        href={`/console/reports/${report.reportId}`}
                        className="after:absolute after:inset-0 focus-visible:outline-none"
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-sm text-ink">
                            {report.reportId.slice(0, 8)}
                          </span>
                          <span className="text-sm text-ink-2">{report.campaignTitle}</span>
                        </span>
                        <span className="mt-1 block max-w-[60ch] text-base text-ink">
                          {report.headline ?? pendingHeadline(report)}
                        </span>
                      </Link>
                      <span className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-ink-3">
                        <span>
                          {pluralize(report.fileCount, "file")}, up to {report.sizeBucket}
                        </span>
                        {report.unreadReplies > 0 ? (
                          <span className="inline-flex items-center gap-1 text-seal-ink">
                            <MessageSquareText className="size-3.5" aria-hidden="true" />
                            {pluralize(report.unreadReplies, "reply", "replies")}
                          </span>
                        ) : null}
                        <span className="sm:hidden">
                          <AnalysisCell report={report} />
                        </span>
                      </span>
                    </td>
                    <td className="hidden px-4 py-4 text-sm text-ink-2 md:table-cell">
                      {formatDateTime(report.receivedBucket)}
                    </td>
                    <td className="hidden px-4 py-4 sm:table-cell">
                      <AnalysisCell report={report} />
                    </td>
                    <td className="px-4 py-4">
                      <Badge tone={statusTone[report.status]}>{report.status}</Badge>
                    </td>
                    <td className="px-4 py-4 text-ink-3 group-hover:text-ink">
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
