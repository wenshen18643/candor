import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

export class RequestLimits {
  private readonly clients = new Map<string, { tokens: number; at: number }>();
  private global: { tokens: number; at: number };
  private active = 0;

  constructor(private readonly now: () => number = Date.now) {
    this.global = { tokens: 600, at: now() };
  }

  acquire(address: string): boolean {
    const now = this.now();
    for (const [key, entry] of this.clients) {
      if (now - entry.at >= 60_000) this.clients.delete(key);
    }
    if (this.active >= 16 || (!this.clients.has(address) && this.clients.size >= 10_000))
      return false;
    const client = this.clients.get(address) ?? { tokens: 60, at: now };
    client.tokens = Math.min(60, client.tokens + Math.max(0, now - client.at) / 1000);
    client.at = now;
    this.clients.set(address, client);
    this.global.tokens = Math.min(
      600,
      this.global.tokens + Math.max(0, now - this.global.at) / 100,
    );
    this.global.at = now;
    if (client.tokens < 1 || this.global.tokens < 1) return false;
    client.tokens--;
    this.global.tokens--;
    this.active++;
    return true;
  }

  release(): void {
    this.active--;
  }
}

export function remoteAddress(context: Context): string {
  try {
    return getConnInfo(context).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}
