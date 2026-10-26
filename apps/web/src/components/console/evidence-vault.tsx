"use client";

import { Check, FileText, KeyRound, LockKeyhole, LockKeyholeOpen, UserRound } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Hash } from "@/components/ui/hash";
import { cn } from "@/lib/cn";
import { useConsole } from "@/lib/console/store";
import type { AccessRequest, ReportDetail, ReviewerIdentity } from "@/lib/console/types";
import { formatBytes, pluralize } from "@/lib/format";

function ShareSlots({
  detail,
  request,
  me,
}: {
  detail: ReportDetail;
  request: AccessRequest | null;
  me: ReviewerIdentity | null;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {detail.reviewers.map((reviewer) => {
        const isRequester = request?.requesterId === reviewer.reviewerId;
        const approved = request?.approvals.some((item) => item.approverId === reviewer.reviewerId);
        const contributed = isRequester || approved;
        return (
          <li
            key={reviewer.reviewerId}
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-3 transition-colors duration-200",
              contributed ? "border-documented/50 bg-documented-soft/40" : "border-line bg-bg",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-base font-medium">
                <UserRound className="size-4 text-ink-3" aria-hidden="true" />
                {reviewer.displayName}
              </span>
              {reviewer.reviewerId === me?.reviewerId ? <Badge tone="outline">You</Badge> : null}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-ink-2">
              <KeyRound className="size-3.5" aria-hidden="true" />
              X25519 key <span className="font-mono">{reviewer.keyId.slice(0, 8)}</span>
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-sm",
                contributed ? "text-documented" : "text-ink-3",
              )}
            >
              {contributed ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <LockKeyhole className="size-3.5" aria-hidden="true" />
              )}
              {isRequester
                ? "Share held by requester"
                : approved
                  ? "Share re-sealed to requester"
                  : "Share sealed"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function EvidenceVault({
  detail,
  onChanged,
}: {
  detail: ReportDetail;
  onChanged: () => void;
}) {
  const { client, identity, unlocked, setUnlocked, reidentify, setReidentify } = useConsole();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<AccessRequest | null>(detail.accessRequest);
  const reportId = detail.summary.reportId;
  const evidence = unlocked[reportId];

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const otherReviewers = detail.reviewers.filter(
    (reviewer) =>
      reviewer.reviewerId !== request?.requesterId &&
      !request?.approvals.some((item) => item.approverId === reviewer.reviewerId),
  );

  if (evidence) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-documented-soft/50 px-4 py-3">
          <p className="flex items-center gap-2 text-base text-ink">
            <LockKeyholeOpen className="size-4 text-documented" aria-hidden="true" />
            Report key reconstructed from {detail.threshold} of {detail.reviewers.length} shares.
            Opened locally in this browser; access is in the transparency log.
          </p>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--seal)]"
              checked={Boolean(reidentify[reportId])}
              onChange={(event) => setReidentify(reportId, event.target.checked)}
            />
            Show real names across this report
          </label>
        </div>
        <div className="scrollbar-quiet overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[720px] text-left">
            <thead className="bg-surface text-xs text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  File
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Submitted as
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Metadata removed on the reporter&apos;s device
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  SHA-256
                </th>
              </tr>
            </thead>
            <tbody>
              {evidence.files.map((file) => (
                <tr key={file.index} className="border-t border-line align-top">
                  <td className="px-3 py-3">
                    <span className="flex items-start gap-2">
                      <FileText className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden="true" />
                      <span>
                        <span className="block text-base text-ink">{file.name}</span>
                        <span className="text-xs text-ink-3">{formatBytes(file.size)}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={file.variant === "original" ? "seal" : "neutral"}>
                      {file.variant === "original" ? "Original" : "Redacted copy"}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <ul className="flex flex-col gap-0.5 text-sm">
                      {file.metadataRemoved.map((field) => (
                        <li key={field.field} className="flex gap-2">
                          <span className="text-ink-2">{field.field}</span>
                          <span className="font-mono text-xs text-ink-3">{field.preview}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-3 py-3">
                    <Hash value={file.sha256} label="file hash" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-ink-2">
          {pluralize(evidence.selfRedactionCount, "self-identifying detail")} were redacted by the
          reporter before encryption and do not exist anywhere outside their device.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-seal-soft text-seal-ink">
          <LockKeyhole className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-md font-semibold">Original files and real names are sealed</h3>
          <p className="mt-1 max-w-[68ch] text-base text-ink-2">
            The reporter&apos;s browser split this report&apos;s key into {detail.reviewers.length}{" "}
            Shamir shares and sealed one to each reviewer. Any {detail.threshold} can reconstruct
            it; nobody can alone, including the server. The analysis above was produced without it.
          </p>
        </div>
      </div>

      <ShareSlots detail={detail} request={request} me={identity} />

      {!request ? (
        <form
          className="flex max-w-[560px] flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run("request", async () => {
              const created = await client.requestAccess(reportId, reason.trim());
              setRequest(created);
              onChanged();
            });
          }}
        >
          <Field
            label="Why do you need the originals?"
            htmlFor="access-reason"
            hint="Your reason is shown to the other reviewers and recorded in the transparency log as a hash."
          >
            <Textarea
              id="access-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="For example: confirm the ledger rows against the payables system."
              required
              minLength={10}
            />
          </Field>
          <div>
            <Button
              type="submit"
              variant="primary"
              loading={busy === "request"}
              disabled={reason.trim().length < 10}
            >
              Request quorum access
            </Button>
          </div>
        </form>
      ) : request.status === "pending" ? (
        <div className="flex flex-col gap-3">
          <p className="text-base text-ink-2">
            Requested by {request.requesterName}: “{request.reason}”. Waiting for{" "}
            {Math.max(0, request.threshold - 1 - request.approvals.length)} more approval.
          </p>
          {client.mode === "showcase" ? (
            <div className="flex flex-wrap gap-2">
              {otherReviewers.slice(0, 1).map((reviewer) => (
                <Button
                  key={reviewer.reviewerId}
                  variant="secondary"
                  loading={busy === "approve"}
                  onClick={() =>
                    void run("approve", async () => {
                      const approver = (await client.listIdentities()).find(
                        (item) => item.reviewerId === reviewer.reviewerId,
                      );
                      if (!approver) throw new Error("Reviewer not found");
                      setRequest(await client.approveAccess(request, approver));
                      onChanged();
                    })
                  }
                >
                  Approve as {reviewer.displayName}
                </Button>
              ))}
              <span className="self-center text-sm text-ink-3">
                In production this happens in the other reviewer&apos;s console, with their own key.
              </span>
            </div>
          ) : null}
        </div>
      ) : request.status === "granted" ? (
        <div className="flex flex-col gap-3">
          <p className="text-base text-ink">
            Quorum reached. Combine the shares in this browser to reconstruct the report key.
          </p>
          <div>
            <Button
              variant="primary"
              loading={busy === "unlock"}
              onClick={() =>
                void run("unlock", async () => {
                  const opened = await client.unlockEvidence(reportId, request);
                  setUnlocked(reportId, opened);
                  onChanged();
                })
              }
            >
              <LockKeyholeOpen aria-hidden="true" />
              Combine shares and decrypt
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-base text-ink-2">This access request was {request.status}.</p>
      )}

      {error ? (
        <p role="alert" className="text-sm text-contradicted">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-ink-3">
        Evidence root <Hash value={detail.evidenceRoot} label="evidence root" /> · committed at log
        index {detail.logIndex}
      </p>
    </div>
  );
}
