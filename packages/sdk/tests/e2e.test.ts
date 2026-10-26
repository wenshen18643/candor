import { b64u } from "@candor/crypto";
import { expect, it } from "vitest";

import { runDemo } from "../src/demo.js";
import {
  CandorClient,
  combineReportShares,
  decryptFile,
  decryptManifest,
  openMessage,
} from "../src/index.js";

it.skipIf(process.env.CANDOR_E2E !== "1")(
  "completes real identity/API submission, payment, custody, inbox and transparency flows",
  async () => {
    const options = {
      apiUrl: process.env.CANDOR_API_URL ?? "http://localhost:8000",
      identityUrl: process.env.CANDOR_IDENTITY_URL ?? "http://localhost:8787",
    };
    const demo = await runDemo(options);
    const reporter = new CandorClient(options);
    const campaign = await reporter.loadCampaign(demo.built.body.campaign_id);
    const identities = await reporter.listIdentities();
    const first = identities[0]!;
    const second = identities[1]!;
    const requester = new CandorClient(options);
    const approver = new CandorClient(options);
    await requester.signIn(first.reviewer_id, b64u.decode(first.sig_sk));
    await approver.signIn(second.reviewer_id, b64u.decode(second.sig_sk));
    const reportId = demo.submitted.report_id;
    const logKey = await reporter.getLogKey();
    const oldHead = await reporter.getVerifiedTreeHead(logKey.public_key);
    const report = await requester.getReport(reportId);
    expect(report.report.evidence_root).toBe(demo.built.body.evidence_root);
    await requester.setStatus(reportId, "investigating");
    expect(
      (await requester.listReports("investigating")).some((row) => row.report_id === reportId),
    ).toBe(true);
    await expect(reporter.submit(demo.built.body, { jitterMs: 0 })).rejects.toMatchObject({
      code: "token_spent",
    });
    const access = await requester.requestAccess(reportId, "Synthetic end-to-end validation");
    const listed = (await approver.listAccessRequests()).find((row) => row.id === access.id)!;
    const approverReport = await approver.getReport(reportId);
    await approver.signAndApproveAccess({
      request: listed,
      sealedShare: approverReport.my_sealed_share,
      boxKeys: { publicKey: b64u.decode(second.enc_pk), privateKey: b64u.decode(second.enc_sk) },
      signPrivateKey: b64u.decode(second.sig_sk),
    });
    const granted = await requester.getAccessRequest(access.id);
    expect(granted.status).toBe("granted");
    const keys = { publicKey: b64u.decode(first.enc_pk), privateKey: b64u.decode(first.enc_sk) };
    const key = await combineReportShares(
      [granted.sealed_share, ...granted.resealed_shares.map((share) => share.resealed_share)],
      keys,
      campaign.threshold,
    );
    const manifest = await decryptManifest(
      reportId,
      report.manifest_box,
      key,
      report.report.evidence_root,
    );
    const file = await requester.getFile(reportId, 0);
    const plaintext = await decryptFile(reportId, manifest.files[0]!, file.box, key);
    expect(plaintext.length).toBe(manifest.files[0]!.size);
    const question = {
      kind: "question" as const,
      body: "Synthetic follow-up",
      questions: [{ question_id: "Q1", text: "Can you confirm the date?" }],
      sent_at: new Date().toISOString(),
    };
    await requester.sendQuestions(reportId, report.report.inbox.enc_pk, question);
    const inbox = await reporter.signInInbox(demo.built.codename);
    expect(inbox.session.report_ids).toContain(reportId);
    const messages = await reporter.readInbox(inbox.keys.box);
    expect(
      messages
        .find((row) => row.report_id === reportId)
        ?.messages.some((message) => message.plaintext?.body === question.body),
    ).toBe(true);
    const reply = {
      kind: "reply" as const,
      body: "Synthetic confirmation",
      answers: [{ question_id: "Q1", text: "2026-10-01" }],
      sent_at: new Date().toISOString(),
    };
    await reporter.reply(reportId, campaign.reviewers, reply);
    const updated = await requester.getReport(reportId);
    const message = updated.messages.find((row) => row.direction === "to_reviewers")!;
    const boxes = message.boxes as { reviewer_id: string; box: unknown }[];
    expect(
      await openMessage(boxes.find((box) => box.reviewer_id === first.reviewer_id)!.box, keys),
    ).toEqual(reply);
    const newHead = await reporter.getVerifiedTreeHead(logKey.public_key);
    expect(await reporter.verifyConsistency(oldHead, newHead, logKey.public_key)).toBe(true);
    expect(await reporter.verifyReceipt(demo.submitted, logKey.public_key)).toBe(true);
    expect((await requester.getJob(demo.jobId)).job_id).toBe(demo.jobId);
    key.fill(0);
  },
  120000,
);
