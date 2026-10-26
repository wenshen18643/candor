import { b64u, utf8 } from "@candor/crypto";
import { detectPii, scrub, stripAndExtract } from "@candor/privacy";

import type { ClientOptions } from "./client.js";
import { CandorClient } from "./client.js";
import { buildSubmission } from "./submission.js";
import type { BuiltSubmission, Submitted } from "./types.js";

export async function runDemo(options: ClientOptions): Promise<{
  built: BuiltSubmission;
  submitted: Submitted;
  jobId: string;
  jobStatus: string;
}> {
  const reporter = new CandorClient(options);
  const campaign = await reporter.loadCampaign("northwind-ethics");
  const session = await reporter.startVerification(campaign.campaign_id);
  const verification = await reporter.mockVerify(
    session.session_id,
    `sdk-demo-${globalThis.crypto.randomUUID()}`,
  );
  if (verification.status !== "verified") throw new Error("Demo verification failed");
  const tokens = await reporter.mintTokens(campaign, session.session_id, 3);
  const file = await stripAndExtract({
    name: "synthetic-memo.txt",
    type: "text/plain",
    bytes: utf8(
      "On 2026-10-01, Dana Whitfield instructed staff to change the safety audit count from 12 to 2. The original audit records 12 incidents.",
    ),
  });
  const documents = [
    {
      docKey: "statement",
      text: "The attached synthetic memo describes a discrepancy in the safety audit.",
    },
    { docKey: "D1", text: file.text! },
  ];
  const scrubbed = scrub(documents, detectPii(documents, { selfTerms: [] }));
  const built = await buildSubmission({
    campaign,
    token: tokens[0]!,
    files: [file],
    variants: ["original"],
    scrub: scrubbed,
    statementKey: "statement",
  });
  const submitted = await reporter.submit(built.body, { jitterMs: 0 });
  const logKey = await reporter.getLogKey();
  if (!(await reporter.verifyReceipt(submitted, logKey.public_key)))
    throw new Error("Demo receipt verification failed");
  const identities = await reporter.listIdentities();
  if (identities.length < campaign.threshold) throw new Error("Demo reviewers missing");
  const reviewers = await Promise.all(
    identities.map(async (identity) => {
      const client = new CandorClient(options);
      const key = b64u.decode(identity.sig_sk);
      try {
        await client.signIn(identity.reviewer_id, key);
      } finally {
        key.fill(0);
      }
      return client;
    }),
  );
  const reviewer = reviewers[0]!;
  const quote = await reviewer.quoteAnalysis(submitted.report_id);
  const job = await reviewer.payAndRunAnalysis(submitted.report_id, quote, { mode: "mock" });
  const state = await reviewer.getJob(job.job_id);
  return { built, submitted, jobId: job.job_id, jobStatus: state.status };
}
