import {
  Anchor,
  BookOpen,
  FileDown,
  FileUp,
  Flag,
  KeyRound,
  ListChecks,
  LockKeyholeOpen,
  type LucideIcon,
  MessageSquare,
  UserCheck,
  Workflow,
} from "lucide-react";

import type { LogEntry, LogReviewer } from "@/lib/audit-client";

export const entryTypeMeta: Record<string, { label: string; icon: LucideIcon; meaning: string }> = {
  "report.submitted": {
    label: "Report submitted",
    icon: FileUp,
    meaning: "A sealed report arrived. Only its evidence root and the hour are public.",
  },
  "report.status_changed": {
    label: "Status changed",
    icon: Flag,
    meaning: "A reviewer moved the report to a new stage.",
  },
  "analysis.requested": {
    label: "Analysis requested",
    icon: Workflow,
    meaning:
      "The organisation paid for one analysis run. The payment is linked only by a keyed hash.",
  },
  "analysis.completed": {
    label: "Analysis completed",
    icon: ListChecks,
    meaning: "The worker sealed findings to the reviewers and published their SHA-256.",
  },
  "findings.opened": {
    label: "Findings opened",
    icon: BookOpen,
    meaning: "A reviewer downloaded the sealed findings for this report.",
  },
  "access.requested": {
    label: "Access requested",
    icon: KeyRound,
    meaning: "A reviewer asked the quorum for the original evidence.",
  },
  "access.approved": {
    label: "Access approved",
    icon: UserCheck,
    meaning: "One approver re-sealed their key share to the requester and signed the approval.",
  },
  "access.granted": {
    label: "Access granted",
    icon: LockKeyholeOpen,
    meaning: "Enough approvals arrived to rebuild the report key in the requester's browser.",
  },
  "evidence.fetched": {
    label: "Evidence fetched",
    icon: FileDown,
    meaning: "A reviewer downloaded one encrypted evidence file.",
  },
  "message.sent": {
    label: "Message sent",
    icon: MessageSquare,
    meaning: "A sealed message moved between reviewers and the anonymous reporter.",
  },
  "anchor.published": {
    label: "Anchor published",
    icon: Anchor,
    meaning: "A tree root was written to an external chain so it can never be quietly replaced.",
  },
};

export function typeMeta(type: string) {
  return (
    entryTypeMeta[type] ?? {
      label: type,
      icon: Workflow,
      meaning: "An event type this auditor does not recognise yet.",
    }
  );
}

export const shortId = (value: string | number | undefined) =>
  typeof value === "string" ? value.slice(0, 8) : String(value ?? "");

export type Directory = Map<string, LogReviewer>;

export function reviewerName(directory: Directory, id: string | number | undefined) {
  if (typeof id !== "string") return "Unknown reviewer";
  return directory.get(id)?.display_name ?? `Reviewer ${shortId(id)}`;
}

const statusLabel: Record<string, string> = {
  received: "received",
  triage: "triage",
  investigating: "investigating",
  closed: "closed",
};

export function summarize(entry: LogEntry, directory: Directory): string {
  const e = entry.entry;
  const report = `report ${shortId(e.report_id)}`;
  switch (entry.entry_type) {
    case "report.submitted":
      return `New ${report} on ${String(e.campaign_id)}`;
    case "report.status_changed":
      return `${reviewerName(directory, e.actor)} moved ${report} to ${statusLabel[String(e.status)] ?? String(e.status)}`;
    case "analysis.requested":
      return `Paid analysis job ${shortId(e.job_id)} for ${report}`;
    case "analysis.completed":
      return `Job ${shortId(e.job_id)} sealed findings for ${report}`;
    case "findings.opened":
      return `${reviewerName(directory, e.reviewer_id)} opened findings for ${report}`;
    case "access.requested":
      return `${reviewerName(directory, e.requester_id)} asked to see originals of ${report}`;
    case "access.approved":
      return `${reviewerName(directory, e.approver_id)} approved request ${shortId(e.request_id)}`;
    case "access.granted":
      return `Quorum reached for request ${shortId(e.request_id)}`;
    case "evidence.fetched":
      return `${reviewerName(directory, e.reviewer_id)} fetched file ${String(e.file_index)} of ${report}`;
    case "message.sent":
      return e.direction === "to_reporter"
        ? `Reviewers wrote to the reporter of ${report}`
        : `The reporter of ${report} replied`;
    case "anchor.published":
      return `Root of the first ${String(e.tree_size)} entries anchored (${String(e.chain)})`;
    default:
      return Object.keys(e)
        .filter((key) => key !== "type")
        .join(", ");
  }
}

export function relatedReport(entry: LogEntry, requests: Map<string, string>): string | null {
  const reportId = entry.entry.report_id;
  if (typeof reportId === "string") return reportId;
  const requestId = entry.entry.request_id;
  if (typeof requestId === "string") return requests.get(requestId) ?? null;
  return null;
}

export function requestIndex(entries: LogEntry[]) {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (
      entry.entry_type === "access.requested" &&
      typeof entry.entry.request_id === "string" &&
      typeof entry.entry.report_id === "string"
    )
      map.set(entry.entry.request_id, entry.entry.report_id);
  }
  return map;
}

export function chainLabel(chain: string) {
  if (chain === "mock") return "Mock chain (demo)";
  if (chain === "base-sepolia" || chain === "eip155:84532") return "Base Sepolia";
  return chain;
}

export function explorerUrl(chain: string, txRef: string) {
  if ((chain === "base-sepolia" || chain === "eip155:84532") && /^0x[0-9a-f]{64}$/i.test(txRef))
    return `https://sepolia.basescan.org/tx/${txRef}`;
  return null;
}

const hourFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

export function formatHour(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  date.setUTCMinutes(0, 0, 0);
  return hourFormat.format(date);
}
