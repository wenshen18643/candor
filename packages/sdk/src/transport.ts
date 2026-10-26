export class CandorError extends Error {
  override readonly name = "CandorError";
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Candor request failed (${status}, ${code})`);
  }
}

export async function responseError(response: Response): Promise<CandorError> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null;
  const value = body?.error?.code;
  const code =
    typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : "http_error";
  return new CandorError(response.status, code);
}

export async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await responseError(response);
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new CandorError(response.status, "invalid_response");
  }
}

export function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type Fetch = typeof globalThis.fetch;
export type RequestOptions = { signal?: AbortSignal; headers?: HeadersInit };

export class Transport {
  constructor(
    readonly baseUrl: string,
    readonly fetch: Fetch,
  ) {
    const url = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid service URL");
  }

  request(
    path: string,
    method: string,
    body?: unknown,
    options: RequestOptions = {},
    token?: string,
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set("Accept", headers.get("Accept") ?? "application/json");
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return this.fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
  }
}
