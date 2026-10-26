"use client";

import {
  ArrowLeft,
  CalendarRange,
  CircleDollarSign,
  FileLock2,
  ListChecks,
  MessagesSquare,
  Network,
  NotebookText,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Brief } from "@/components/console/brief";
import { ClaimSheet } from "@/components/console/claim-sheet";
import { ClaimsTable } from "@/components/console/claims-table";
import { EntityGraph } from "@/components/console/entity-graph";
import { EvidenceVault } from "@/components/console/evidence-vault";
import { PassageQuote } from "@/components/console/passage-quote";
import { PaySheet } from "@/components/console/pay-sheet";
import {
  PipelineDag,
  type StageState,
  stageStatesFromRuns,
} from "@/components/console/pipeline-dag";
import { Questions } from "@/components/console/questions";
import { Timeline } from "@/components/console/timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/field";
import { Hash } from "@/components/ui/hash";
import { Sheet } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConsole, usePseudonymMap } from "@/lib/console/store";
import type { PaymentRequirements, ReportDetail, ReportStatus } from "@/lib/console/types";
import { formatDateTime } from "@/lib/format";
import type { AnalysisResult, StageEvent } from "@/lib/types";

const statuses: ReportStatus[] = ["received", "triage", "investigating", "closed"];

function EmptyAnalysis({
  onRun,
  price,
  failure,
}: {
  onRun: () => void;
  price: number;
  failure: string | null;
}) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed border-line-strong p-6">
      <div>
        <h2 className="text-lg font-semibold">
          {failure ? "The last analysis stopped" : "No analysis yet"}
        </h2>
        {failure ? (
          <p role="alert" className="mt-1 max-w-[64ch] text-base text-contradicted">
            {failure}
          </p>
        ) : null}
        <p className="mt-1 max-w-[64ch] text-base text-ink-2">
          Running the analysis sends only the redacted, pseudonymised view of this report to the
          analysis worker, which decrypts it in memory, runs the twelve-stage pipeline on Meta Muse,
          and seals the findings back to each reviewer. Originals and real names stay sealed.
        </p>
      </div>
      <Button variant="primary" onClick={onRun}>
        <CircleDollarSign aria-hidden="true" />
        {failure ? "Run again" : "Run analysis"} · {price.toFixed(2)} USDC
      </Button>
    </div>
  );
}

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const reportId = params.id;
  const { client } = useConsole();
  const map = usePseudonymMap(reportId);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("brief");
  const [claimId, setClaimId] = useState<string | null>(null);
  const [passageId, setPassageId] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [requirements, setRequirements] = useState<PaymentRequirements | null>(null);
  const [liveStages, setLiveStages] = useState<Record<string, StageState> | null>(null);
  const [running, setRunning] = useState(false);
  const watching = useRef<string | null>(null);

  const load = useCallback(() => {
    client
      .getReport(reportId)
      .then(setDetail)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load report"));
  }, [client, reportId]);

  useEffect(() => {
    load();
  }, [load]);

  const analysis: AnalysisResult | null = detail?.analysis ?? null;
  const claim = useMemo(
    () => analysis?.claims.find((item) => item.claim_id === claimId) ?? null,
    [analysis, claimId],
  );
  const passage = useMemo(
    () => analysis?.passages.find((item) => item.passage_id === passageId),
    [analysis, passageId],
  );

  async function openPay() {
    setPayOpen(true);
    setRequirements(null);
    setRequirements(await client.quoteAnalysis(reportId));
  }

  const onStage = useCallback((event: StageEvent) => {
    setLiveStages((current) => ({
      ...(current ?? {}),
      [event.stage]: {
        ...(current?.[event.stage] ?? {}),
        status: event.status === "progress" ? "started" : event.status,
        detail: event.detail,
        model: event.model,
      },
    }));
  }, []);

  const follow = useCallback(
    (done: Promise<AnalysisResult>) => {
      setRunning(true);
      done
        .then((result) => {
          setLiveStages(stageStatesFromRuns(result.stages));
          setRunning(false);
          load();
        })
        .catch((cause) => {
          setRunning(false);
          setError(cause instanceof Error ? cause.message : "Analysis failed");
          load();
        });
    },
    [load],
  );

  useEffect(() => {
    const state = detail?.summary.analysis;
    if (!state || (state.status !== "queued" && state.status !== "running")) return;
    if (watching.current === state.jobId) return;
    watching.current = state.jobId;
    setLiveStages({});
    follow(client.watchAnalysis(reportId, state.jobId, onStage));
  }, [detail, client, reportId, follow, onStage]);

  async function pay() {
    if (!requirements) throw new Error("No payment quote");
    setLiveStages({});
    setRunning(true);
    setError(null);
    setTab("pipeline");
    const { receipt, jobId, done } = await client.payAndRunAnalysis(
      reportId,
      requirements,
      onStage,
    );
    watching.current = jobId;
    follow(done);
    return receipt;
  }

  if (error && !detail) {
    return (
      <div className="px-8 py-10">
        <p role="alert" className="text-contradicted">
          {error}
        </p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-5 py-8 sm:px-8">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const stageStates = liveStages ?? (analysis ? stageStatesFromRuns(analysis.stages) : {});
  const hasAnalysis = Boolean(analysis) && !running;
  const lastRun = detail.summary.analysis;
  const failure =
    error ?? (lastRun.status === "failed" || lastRun.status === "dead" ? lastRun.error : null);
  const empty = <EmptyAnalysis onRun={openPay} price={detail.priceUsd} failure={failure} />;

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-6 sm:px-8">
      <Link
        href="/console"
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-ink-2 hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Reports
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-medium tracking-tight">{reportId.slice(0, 8)}</h1>
            <Badge tone="outline">{detail.summary.campaignTitle}</Badge>
            {map ? (
              <Badge tone="seal">Real names shown</Badge>
            ) : (
              <Badge tone="neutral">Pseudonymised</Badge>
            )}
          </div>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
            <div className="flex gap-1.5">
              <dt>Received</dt>
              <dd className="text-ink">{formatDateTime(detail.summary.receivedBucket)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Evidence root</dt>
              <dd>
                <Hash value={detail.evidenceRoot} label="evidence root" />
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Custody</dt>
              <dd className="text-ink">
                {detail.threshold} of {detail.reviewers.length} reviewers
              </dd>
            </div>
          </dl>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="status" className="sr-only">
            Report status
          </label>
          <select
            id="status"
            value={detail.summary.status}
            onChange={async (event) => {
              await client.setStatus(reportId, event.target.value as ReportStatus);
              load();
            }}
            className="h-9 cursor-pointer rounded-md border border-line-strong bg-bg px-2.5 text-base capitalize hover:border-ink-3"
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          {analysis ? (
            <Button variant="secondary" onClick={openPay} disabled={running}>
              Re-run analysis
            </Button>
          ) : null}
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="brief">
            <NotebookText aria-hidden="true" />
            Brief
          </TabsTrigger>
          <TabsTrigger value="timeline" disabled={!hasAnalysis}>
            <CalendarRange aria-hidden="true" />
            Timeline
          </TabsTrigger>
          <TabsTrigger value="claims" disabled={!hasAnalysis}>
            <ListChecks aria-hidden="true" />
            Claims
            {analysis ? (
              <span className="tabular text-xs text-ink-3">
                <span className="sr-only">, </span>
                {analysis.claims.length}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="people" disabled={!hasAnalysis}>
            <Network aria-hidden="true" />
            People
          </TabsTrigger>
          <TabsTrigger value="questions" disabled={!hasAnalysis}>
            <MessagesSquare aria-hidden="true" />
            Questions
          </TabsTrigger>
          <TabsTrigger value="evidence">
            <FileLock2 aria-hidden="true" />
            Evidence
          </TabsTrigger>
          <TabsTrigger value="pipeline">
            <Workflow aria-hidden="true" />
            Pipeline
          </TabsTrigger>
        </TabsList>

        <div className="py-8">
          <TabsContent value="brief">
            {hasAnalysis && analysis ? (
              <Brief analysis={analysis} map={map} onClaim={setClaimId} onPassage={setPassageId} />
            ) : running ? (
              <p className="text-base text-ink-2">
                The analysis is running. Follow it on the Pipeline tab.
              </p>
            ) : (
              empty
            )}
          </TabsContent>
          {analysis ? (
            <>
              <TabsContent value="timeline">
                <Timeline analysis={analysis} map={map} onClaim={setClaimId} />
              </TabsContent>
              <TabsContent value="claims">
                <ClaimsTable analysis={analysis} map={map} onClaim={setClaimId} />
              </TabsContent>
              <TabsContent value="people">
                <EntityGraph analysis={analysis} map={map} onClaim={setClaimId} />
              </TabsContent>
              <TabsContent value="questions">
                <Questions
                  analysis={analysis}
                  detail={detail}
                  map={map}
                  onClaim={setClaimId}
                  onSent={load}
                />
              </TabsContent>
            </>
          ) : null}
          <TabsContent value="evidence">
            <EvidenceVault detail={detail} onChanged={load} />
          </TabsContent>
          <TabsContent value="pipeline">
            {Object.keys(stageStates).length > 0 || running ? (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="text-lg font-semibold">
                    {!running
                      ? "Last analysis run"
                      : Object.keys(stageStates).length > 0
                        ? "Analysis running"
                        : "Paid and queued, waiting for a worker"}
                  </h2>
                  <p className="mt-1 max-w-[68ch] text-base text-ink-2">
                    The worker pulls the job, unseals the analysis key with its enclave key, and
                    streams each stage&apos;s progress here over server-sent events. Plaintext
                    exists only in the worker&apos;s memory.
                  </p>
                  {failure && !running ? (
                    <p role="alert" className="mt-2 max-w-[68ch] text-base text-contradicted">
                      {failure}
                    </p>
                  ) : null}
                </div>
                <PipelineDag states={stageStates} />
              </div>
            ) : (
              empty
            )}
          </TabsContent>
        </div>
      </Tabs>

      {analysis ? (
        <ClaimSheet
          claim={claim}
          analysis={analysis}
          map={map}
          open={claim !== null}
          onOpenChange={(open) => !open && setClaimId(null)}
          onClaim={setClaimId}
        />
      ) : null}

      {analysis && passage ? (
        <Sheet
          open={Boolean(passage)}
          onOpenChange={(open) => !open && setPassageId(null)}
          title={<span className="font-mono">{passage.passage_id}</span>}
          description="Source passage"
        >
          <PassageQuote
            passage={passage}
            citation={{
              passage_id: passage.passage_id,
              quote: "",
              quote_verified: true,
              match_start: null,
              match_end: null,
            }}
            map={map}
            docTitle={analysis.documents?.find((doc) => doc.doc_id === passage.doc_id)?.title}
          />
          {passage.injection_signals.length > 0 ? (
            <div className="mt-4 text-sm text-ink-2">
              <h3 className="font-semibold text-ink">Injection signals</h3>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {passage.injection_signals.map((signal) => (
                  <Badge key={signal} tone="quarantine">
                    {signal.replaceAll("_", " ")}
                  </Badge>
                ))}
              </ul>
              <p className="mt-2">
                Risk {Math.round(passage.injection_risk * 100)} / 100. Quarantined passages stay
                visible to reviewers but are never followed as instructions, and claims resting only
                on them are marked unsupported.
              </p>
            </div>
          ) : null}
        </Sheet>
      ) : null}

      <PaySheet
        open={payOpen}
        onOpenChange={setPayOpen}
        requirements={requirements}
        mode={client.mode}
        onPay={pay}
      />
    </div>
  );
}
