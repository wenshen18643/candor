import { b64u, sealJson } from "@candor/crypto";
import { expect, it, vi } from "vitest";

import type { BuildSubmissionInput } from "../src/index.js";
import { buildSubmission, CandorClient } from "../src/index.js";
import { fixture } from "./fixtures.js";

it.each<[string, (input: BuildSubmissionInput) => BuildSubmissionInput]>([
  ["issuer mismatch", (input) => ({ ...input, token: { ...input.token, key_id: "b".repeat(16) } })],
  [
    "enclave mismatch",
    (input) => ({
      ...input,
      campaign: {
        ...input.campaign,
        enclave: { ...input.campaign.enclave, key_id: "b".repeat(32) },
      },
    }),
  ],
  [
    "duplicate reviewers",
    (input) => ({
      ...input,
      campaign: {
        ...input.campaign,
        reviewers: [input.campaign.reviewers[0]!, input.campaign.reviewers[0]!],
      },
    }),
  ],
  ["invalid threshold", (input) => ({ ...input, campaign: { ...input.campaign, threshold: 4 } })],
  ["missing statement", (input) => ({ ...input, statementKey: "absent" })],
  [
    "unsupported evidence",
    (input) => ({ ...input, files: [{ ...input.files[0]!, kind: "unsupported" }] }),
  ],
])("rejects %s before transmission", async (_name, change) => {
  const { input } = await fixture();
  await expect(buildSubmission(change(input))).rejects.toThrow();
});

it("posts only the submission body, binds receipts, and cancels during jitter", async () => {
  const { input } = await fixture();
  const built = await buildSubmission(input);
  const submitted = {
    report_id: built.body.report_id,
    receipt: { evidence_root: built.body.evidence_root, log_index: 0, sth: {} },
  };
  const fetch = vi.fn(async () => Response.json(submitted));
  const client = new CandorClient({
    apiUrl: "https://api.test",
    identityUrl: "https://identity.test",
    fetch,
  });
  expect(await client.submit(built.body, { jitterMs: 0 })).toEqual(submitted);
  const init = (fetch.mock.calls as unknown as [string, RequestInit][])[0]![1];
  expect(init.body).toBe(JSON.stringify(built.body));
  expect(String(init.body)).not.toContain(built.codename);
  fetch.mockImplementation(async () => Response.json({ ...submitted, report_id: "substituted" }));
  await expect(client.submit(built.body, { jitterMs: 0 })).rejects.toMatchObject({
    code: "receipt_mismatch",
  });
  const count = fetch.mock.calls.length;
  await expect(
    client.submit(built.body, { jitterMs: 10000, signal: AbortSignal.timeout(5) }),
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(count);
});

it("decrypts only reporter inbox messages and posts a signed approval", async () => {
  const { input, reviewers, signing } = await fixture();
  const built = await buildSubmission(input);
  const question = {
    kind: "message",
    body: "Synthetic question",
    questions: [],
    sent_at: "2026-10-26T00:00:00Z",
  };
  const box = sealJson(question, reviewers[0]!.publicKey);
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    Response.json({
      reports: [
        {
          report_id: "r",
          status: "received",
          messages: [
            { id: "m", direction: "to_reporter", box },
            { id: "reply", direction: "to_reviewers", boxes: [] },
          ],
        },
      ],
    }),
  );
  const client = new CandorClient({
    apiUrl: "https://api.test",
    identityUrl: "https://identity.test",
    fetch,
    inboxToken: "inbox",
  });
  const inbox = await client.readInbox(reviewers[0]!);
  expect(inbox[0]!.messages[0]!.plaintext).toEqual(question);
  expect(inbox[0]!.messages[1]!.plaintext).toBeNull();
  const request = {
    id: "access",
    report_id: built.body.report_id,
    requester_id: "r0",
    requester_enc_pk: b64u.encode(reviewers[0]!.publicKey),
  };
  await client.signAndApproveAccess({
    request,
    sealedShare: built.body.key_shares.shares[1]!.sealed_share,
    boxKeys: reviewers[1]!,
    signPrivateKey: signing[1]!.privateKey,
  });
  expect(String(fetch.mock.lastCall![0])).toBe(
    "https://api.test/v1/access-requests/access/approve",
  );
  const approval = JSON.parse(String(fetch.mock.lastCall![1]!.body)) as {
    signature: string;
    resealed_share: string;
  };
  expect(b64u.decode(approval.signature)).toHaveLength(64);
  expect(b64u.decode(approval.resealed_share)).toHaveLength(81);
});
