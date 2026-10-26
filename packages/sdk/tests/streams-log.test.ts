import type { SignedTreeHead } from "@candor/crypto";
import {
  b64u,
  generateSignKeyPair,
  keyId,
  leafHash,
  merkleRoot,
  ready,
  signDetached,
  sthMessage,
  toHex,
  utf8,
} from "@candor/crypto";
import { describe, expect, it, vi } from "vitest";

import type { Schemas } from "../src/index.js";
import {
  CandorClient,
  parseSse,
  streamJobEvents,
  verifyLogConsistency,
  verifyLogInclusion,
  verifySubmissionReceipt,
  verifyTreeHead,
} from "../src/index.js";

function chunks(parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      parts.forEach((part) => controller.enqueue(utf8(part)));
      controller.close();
    },
  });
}
const stage = { job_id: "job", stage: "segment", status: "started", at: "2026-10-26T00:00:00Z" };
const streamResponse = (body: string): Response =>
  new Response(chunks([body]), { headers: { "Content-Type": "text/event-stream" } });

describe("SSE", () => {
  it("dispatches a CR-terminated event at EOF and decodes split UTF-8", async () => {
    expect(await collect(parseSse(chunks(["data: complete\r\r"])))).toEqual([
      { event: "message", data: "complete" },
    ]);
    const bytes = utf8("data: café\n\n");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    expect(await collect(parseSse(stream))).toEqual([{ event: "message", data: "café" }]);
  });
  it("parses chunk boundaries, CRLF, comments, multiline data, ids and retry", async () => {
    const events = await collect(
      parseSse(
        chunks([
          ": heartbeat\r",
          "\nid: 1\r\nevent: stage\r\ndata: first\r\n",
          "data: second\r\nretry: 12\r\n\r",
          "\nid: 2\ndata: next\n\n",
          "data: incomplete",
        ]),
      ),
    );
    expect(events).toEqual([
      { id: "1", event: "stage", data: "first\nsecond", retry: 12 },
      { id: "2", event: "message", data: "next" },
    ]);
  });

  it("reconnects with Last-Event-ID, suppresses duplicates and stops at done", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const cursor = new Headers(init?.headers).get("Last-Event-ID");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer reviewer");
      return cursor === null
        ? streamResponse(`id: 1\nevent: stage\ndata: ${JSON.stringify(stage)}\n\n`)
        : streamResponse(
            `id: 1\nevent: stage\ndata: ${JSON.stringify(stage)}\n\nid: 2\nevent: stage\ndata: ${JSON.stringify({ ...stage, status: "succeeded" })}\n\nevent: done\ndata: {"job_id":"job","status":"succeeded"}\n\n`,
          );
    });
    const client = new CandorClient({
      apiUrl: "https://api.test",
      identityUrl: "https://identity.test",
      fetch,
      token: "reviewer",
    });
    const events = await collect(client.streamJobEvents("job", { retryMs: 0 }));
    expect(events.map((event) => event.event)).toEqual(["stage", "stage", "done"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Headers(fetch.mock.lastCall![1]?.headers).get("Last-Event-ID")).toBe("1");
  });

  it("retries transient failures but rejects malformed events and expired authentication", async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValue(streamResponse('event: done\ndata: {"status":"succeeded"}\n\n'));
    expect(await collect(streamJobEvents(connect, "job", { retryMs: 0 }))).toHaveLength(1);
    await expect(
      collect(
        streamJobEvents(async () => streamResponse("event: stage\ndata: invalid\n\n"), "job"),
      ),
    ).rejects.toMatchObject({ code: "invalid_event" });
    await expect(
      collect(
        streamJobEvents(
          async () => streamResponse('event: done\ndata: {"status":"auth_expired"}\n\n'),
          "job",
        ),
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      collect(streamJobEvents(async () => streamResponse(""), "job", { maxReconnects: 0 })),
    ).rejects.toMatchObject({ code: "stream_disconnected" });
    await expect(
      collect(streamJobEvents(async () => new Response("wrong"), "job")),
    ).rejects.toMatchObject({ code: "invalid_event_stream" });
  });

  it("cancels blocked reads and bounds unfinished frames", async () => {
    const controller = new AbortController();
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const collecting = collect(parseSse(stream, controller.signal));
    controller.abort();
    await expect(collecting).rejects.toThrow();
    expect(cancelled).toHaveBeenCalled();
    await expect(collect(parseSse(chunks(["x".repeat(1048577)])))).rejects.toMatchObject({
      code: "event_too_large",
    });
  });
});

describe("transparency", () => {
  it("binds the receipt to signed leaf bytes and verifies append-only growth", async () => {
    await ready();
    const keys = generateSignKeyPair();
    const publicKey = b64u.encode(keys.publicKey);
    const entry = {
      type: "report.submitted",
      report_id: "report",
      campaign_id: "test",
      evidence_root: "a".repeat(64),
      bucket: "2026-10-26T00:00:00Z",
    };
    const leaves = [utf8(JSON.stringify(entry)), utf8('{"type":"second"}')];
    const signed = (count: number): SignedTreeHead => {
      const head = {
        tree_size: count,
        root_hash: toHex(merkleRoot(leaves.slice(0, count))),
        timestamp: "2026-10-26T00:00:00Z",
        key_id: keyId(keys.publicKey),
      };
      return { ...head, signature: b64u.encode(signDetached(sthMessage(head), keys.privateKey)) };
    };
    const first = signed(1);
    const second = signed(2);
    const proof = {
      index: 0,
      tree_size: 1,
      leaf_hash: toHex(leafHash(leaves[0]!)),
      audit_path: [],
    };
    const row: Schemas["LogEntry"] = {
      index: 0,
      entry_type: "report.submitted",
      entry,
      leaf_b64u: b64u.encode(leaves[0]!),
      created_at: entry.bucket,
    };
    const submitted = {
      report_id: "report",
      receipt: { evidence_root: entry.evidence_root, log_index: 0, sth: first },
    };
    expect(await verifyTreeHead(first, publicKey)).toBe(true);
    expect(await verifyTreeHead({ ...first, root_hash: second.root_hash }, publicKey)).toBe(false);
    expect(await verifyLogInclusion(row.leaf_b64u, proof, first, publicKey)).toBe(true);
    expect(await verifySubmissionReceipt(submitted, row, proof, publicKey)).toBe(true);
    expect(
      await verifySubmissionReceipt({ ...submitted, report_id: "other" }, row, proof, publicKey),
    ).toBe(false);
    expect(
      await verifySubmissionReceipt(
        submitted,
        { ...row, leaf_b64u: b64u.encode(utf8("{}")) },
        proof,
        publicKey,
      ),
    ).toBe(false);
    const consistency = { first: 1, second: 2, proof: [toHex(leafHash(leaves[1]!))] };
    expect(await verifyLogConsistency(first, second, consistency, publicKey)).toBe(true);
    expect(
      await verifyLogConsistency(first, second, { ...consistency, proof: [] }, publicKey),
    ).toBe(false);
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      return Response.json(
        path.endsWith("/entries")
          ? [row]
          : path.endsWith("/inclusion")
            ? proof
            : path.endsWith("/consistency")
              ? consistency
              : first,
      );
    });
    const client = new CandorClient({
      apiUrl: "https://api.test",
      identityUrl: "https://identity.test",
      fetch,
    });
    expect(await client.verifyReceipt(submitted, publicKey)).toBe(true);
    expect(await client.getVerifiedTreeHead(publicKey)).toEqual(first);
    expect(await client.verifyConsistency(first, second, publicKey)).toBe(true);
    await expect(
      client.getVerifiedTreeHead(b64u.encode(generateSignKeyPair().publicKey)),
    ).rejects.toMatchObject({ code: "invalid_tree_head" });
  });
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}
