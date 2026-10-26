import { ServiceError } from "./models.js";

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ServiceError(400, "invalid_request");
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new ServiceError(400, "invalid_request");
  }
  return value;
}

export function campaignId(value: unknown): string {
  const id = text(value, 128);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new ServiceError(400, "invalid_campaign_id");
  return id;
}

export function integer(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new ServiceError(400, "invalid_request");
  }
  return value;
}

export function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new ServiceError(400, "invalid_session_id");
  }
  return value;
}

export function blindedMessages(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new ServiceError(400, "invalid_message_count");
  }
  const messages = value.map((item: unknown) => text(item, 342));
  if (new Set(messages).size !== messages.length) throw new ServiceError(400, "duplicate_message");
  return messages;
}
