import {
  approvalMessage,
  b64u,
  context,
  decryptBox,
  decryptJson,
  encryptJson,
  openSealedKey,
  randomKey,
  sealKey,
  sha256,
  toHex,
  utf8,
  verifyDetached,
} from "@candor/crypto";
import { describe, expect, it } from "vitest";

import type { AnalysisPayload, SealStep } from "../src/index.js";
import {
  buildSubmission,
  combineReportShares,
  createApproval,
  decryptFile,
  decryptManifest,
  openFindings,
  openMessage,
  reidentifyResult,
  sealQuestion,
  sealReply,
} from "../src/index.js";
import { analysisResult, fixture } from "./fixtures.js";

describe("submission and custody", () => {
  it("opens originals with every 2 of 3 quorum and the analysis with only the enclave key", async () => {
    const { input, reviewers, enclave, signing } = await fixture();
    const steps: SealStep[] = [];
    const { body, codename } = await buildSubmission({
      ...input,
      onStep: (step) => steps.push(step),
    });
    expect(codename.split("-")).toHaveLength(8);
    expect(steps.map((step) => step.id)).toEqual([
      "key",
      "root",
      "encrypt",
      "split",
      "analysis",
      "inbox",
    ]);
    expect(JSON.stringify(steps)).not.toContain("Dana");
    expect(JSON.stringify(steps)).not.toContain(codename);
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const requester = reviewers[a!]!;
      const approver = reviewers[b!]!;
      const request = {
        id: "request",
        report_id: body.report_id,
        requester_id: `reviewer-${a}`,
        requester_enc_pk: b64u.encode(requester.publicKey),
      };
      const approval = await createApproval({
        request,
        sealedShare: body.key_shares.shares[b!]!.sealed_share,
        boxKeys: approver,
        signPrivateKey: signing[b!]!.privateKey,
      });
      expect(
        verifyDetached(
          b64u.decode(approval.signature),
          approvalMessage(request.id, body.report_id, request.requester_id),
          signing[b!]!.publicKey,
        ),
      ).toBe(true);
      const own = body.key_shares.shares[a!]!.sealed_share;
      await expect(combineReportShares([own], requester, 2)).rejects.toThrow("quorum");
      await expect(combineReportShares([own, own], requester, 2)).rejects.toThrow("Duplicate");
      const key = await combineReportShares([own, approval.resealed_share], requester, 2);
      const manifest = await decryptManifest(
        body.report_id,
        body.manifest,
        key,
        body.evidence_root,
      );
      expect(manifest.pseudonym_map).toEqual(input.scrub.pseudonymMap);
      expect(manifest.files[0]!.metadata_removed[0]!.preview).toBe("***");
      expect(
        await decryptFile(body.report_id, manifest.files[0]!, body.files[0]!.box, key),
      ).toEqual(input.files[0]!.bytes);
      await expect(decryptManifest("other", body.manifest, key)).rejects.toThrow();
      await expect(
        decryptManifest(body.report_id, body.manifest, key, "0".repeat(64)),
      ).rejects.toThrow("root");
      await expect(
        decryptFile(body.report_id, { ...manifest.files[0]!, size: 1 }, body.files[0]!.box, key),
      ).rejects.toThrow("digest");
    }
    const analysisKey = openSealedKey(
      body.analysis.sealed_key,
      enclave.publicKey,
      enclave.privateKey,
    );
    const payload = decryptJson<AnalysisPayload>(
      analysisKey,
      body.analysis.box,
      context("analysis", body.report_id),
    );
    expect(payload.report_id).toBe(body.report_id);
    expect(payload.documents[0]!.text).toBe(input.scrub.documents[1]!.text);
    expect(JSON.stringify(payload)).not.toContain("Dana");
    expect(JSON.stringify(payload)).not.toContain("Private title");
    expect(() =>
      openSealedKey(body.analysis.sealed_key, reviewers[0]!.publicKey, reviewers[0]!.privateKey),
    ).toThrow();
    expect(() =>
      decryptJson(analysisKey, body.manifest, context("manifest", body.report_id)),
    ).toThrow();
  });

  it("encrypts redacted bytes and refuses missing decisions or unstripped metadata", async () => {
    const { input, reviewers } = await fixture();
    const { body } = await buildSubmission({ ...input, variants: ["redacted"] });
    const shares = body.key_shares.shares
      .slice(0, 2)
      .map((share, i) =>
        openSealedKey(share.sealed_share, reviewers[i]!.publicKey, reviewers[i]!.privateKey),
      );
    const sealed = shares.map((share) => sealKey(share, reviewers[0]!.publicKey));
    const key = await combineReportShares(sealed, reviewers[0]!, 2);
    const manifest = await decryptManifest(body.report_id, body.manifest, key);
    expect(manifest.files[0]!.variant).toBe("redacted");
    expect(await decryptFile(body.report_id, manifest.files[0]!, body.files[0]!.box, key)).toEqual(
      utf8(input.scrub.documents[1]!.text),
    );
    await expect(buildSubmission({ ...input, variants: [] })).rejects.toThrow("variants");
    await expect(
      buildSubmission({
        ...input,
        variants: ["redacted"],
        scrub: { ...input.scrub, documents: [] },
      }),
    ).rejects.toThrow("scrubbed");
    await expect(
      buildSubmission({
        ...input,
        files: [
          {
            ...input.files[0]!,
            metadataRemaining: [{ field: "Author", value: "Private", risk: "high" }],
          },
        ],
      }),
    ).rejects.toThrow("metadata");
  });

  it("verifies findings digests and keeps display reidentification immutable and nonrecursive", async () => {
    const { reviewers, input } = await fixture();
    const key = randomKey();
    const result = analysisResult("report");
    const box = encryptJson(key, result, context("findings", "report"));
    const findings = {
      job_id: "job",
      box,
      sealed_key: sealKey(key, reviewers[0]!.publicKey),
      findings_sha256: toHex(sha256(decryptBox(key, box, context("findings", "report")))),
    };
    const opened = await openFindings("report", findings, reviewers[0]!);
    expect(opened).toEqual(result);
    await expect(
      openFindings("report", { ...findings, findings_sha256: "0".repeat(64) }, reviewers[0]!),
    ).rejects.toThrow("digest");
    await expect(openFindings("report", findings, reviewers[1]!)).rejects.toThrow();
    const identified = reidentifyResult(opened, input.scrub.pseudonymMap);
    expect(identified.summary.headline).toBe("Dana Whitfield and PERSON_10");
    expect(identified.entities[0]!.entity_id).toBe("PERSON_1");
    expect(result.summary.headline).toBe("PERSON_1 and PERSON_10");
    expect(
      reidentifyResult(result, [
        { ...input.scrub.pseudonymMap[0]!, value: "PERSON_10" },
        { ...input.scrub.pseudonymMap[0]!, placeholder: "PERSON_10", value: "Second" },
      ]).summary.headline,
    ).toBe("PERSON_10 and Second");
  });

  it("seals questions and per-reviewer replies", async () => {
    const { input, reviewers } = await fixture();
    const question = {
      kind: "question" as const,
      body: "Synthetic question",
      questions: [{ question_id: "q1", text: "When?" }],
      sent_at: "2026-10-26T00:00:00Z",
    };
    const sealed = await sealQuestion(question, input.campaign.reviewers[0]!.enc_pk);
    expect(await openMessage(sealed, reviewers[0]!)).toEqual(question);
    await expect(openMessage(sealed, reviewers[1]!)).rejects.toThrow();
    await expect(openMessage({}, reviewers[0]!)).rejects.toThrow("envelope");
    const reply = {
      kind: "reply" as const,
      body: "Synthetic reply",
      answers: question.questions,
      sent_at: question.sent_at,
    };
    const boxes = await sealReply(reply, input.campaign.reviewers);
    for (const [i, box] of boxes.entries())
      expect(await openMessage(box.box, reviewers[i]!)).toEqual(reply);
  });
});
