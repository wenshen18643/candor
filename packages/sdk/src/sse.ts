import type { StageEvent } from "./contracts.generated.js";
import { CandorError, delay, responseError } from "./transport.js";

export type ServerEvent = { id?: string; event: string; data: string; retry?: number };
export type JobEvent =
  | { id?: string; event: "stage"; data: StageEvent }
  | { id?: string; event: "done"; data: { status: string; job_id?: string } };
export type StreamOptions = {
  signal?: AbortSignal;
  lastEventId?: string;
  maxReconnects?: number;
  retryMs?: number;
};

export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<ServerEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let event: ServerEvent = { event: "message", data: "" };
  let data: string[] = [];
  let eventSize = 0;
  const abort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r\n|\r|\n/.exec(pending))) {
        if (match[0] === "\r" && match.index === pending.length - 1) break;
        const line = pending.slice(0, match.index);
        pending = pending.slice(match.index + match[0].length);
        eventSize += line.length;
        if (eventSize > 1048576) throw new CandorError(0, "event_too_large");
        if (line === "") {
          if (data.length || event.id !== undefined || event.retry !== undefined)
            yield { ...event, data: data.join("\n") };
          event = { event: "message", data: "" };
          data = [];
          eventSize = 0;
          continue;
        }
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "data") data.push(value);
        if (field === "event") event.event = value;
        if (field === "id" && !value.includes("\0")) event.id = value;
        if (field === "retry" && /^\d+$/.test(value)) event.retry = Math.min(Number(value), 30000);
      }
      if (pending.length + eventSize > 1048576) throw new CandorError(0, "event_too_large");
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function decodeJobEvent(event: ServerEvent, jobId: string): JobEvent | null {
  if (!["stage", "done"].includes(event.event)) return null;
  try {
    const value = JSON.parse(event.data) as Record<string, unknown>;
    if (typeof value !== "object" || value === null || typeof value.status !== "string")
      throw new Error();
    if (event.event === "done") {
      if (value.job_id !== undefined && value.job_id !== jobId) throw new Error();
      if (value.status === "auth_expired") throw new CandorError(401, "auth_expired");
      return { id: event.id, event: "done", data: value as { status: string; job_id?: string } };
    }
    if (value.job_id !== jobId || typeof value.stage !== "string" || typeof value.at !== "string")
      throw new Error();
    return { id: event.id, event: "stage", data: value as unknown as StageEvent };
  } catch (error) {
    if (error instanceof CandorError) throw error;
    throw new CandorError(0, "invalid_event");
  }
}

export async function* streamJobEvents(
  connect: (lastEventId: string | undefined, signal?: AbortSignal) => Promise<Response>,
  jobId: string,
  options: StreamOptions = {},
): AsyncGenerator<JobEvent> {
  let cursor = options.lastEventId;
  let retryMs = options.retryMs ?? 1000;
  const maxReconnects = options.maxReconnects ?? 5;
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    try {
      const response = await connect(cursor, options.signal);
      if (!response.ok) throw await responseError(response);
      if (
        !response.body ||
        !response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")
      )
        throw new CandorError(0, "invalid_event_stream");
      for await (const event of parseSse(response.body, options.signal)) {
        if (event.retry !== undefined) retryMs = event.retry;
        if (
          event.id &&
          cursor &&
          /^\d+$/.test(event.id) &&
          /^\d+$/.test(cursor) &&
          BigInt(event.id) <= BigInt(cursor)
        )
          continue;
        const decoded = decodeJobEvent(event, jobId);
        if (event.id !== undefined) cursor = event.id;
        if (decoded) {
          yield decoded;
          if (decoded.event === "done") return;
        }
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof CandorError && error.status < 500 && error.status !== 429) throw error;
      if (!(error instanceof TypeError) && !(error instanceof CandorError)) throw error;
    }
    if (attempt >= maxReconnects) throw new CandorError(0, "stream_disconnected");
    await delay(Math.min(30000, retryMs), options.signal);
  }
}
