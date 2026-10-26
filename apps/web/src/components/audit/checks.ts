import type { SignedTreeHead } from "@/lib/audit-client";

export type Check =
  | { status: "idle" }
  | { status: "running" }
  | { status: "pass"; detail: string }
  | { status: "fail"; detail: string };

export const idle: Check = { status: "idle" };

export type Checkpoint = {
  id: string;
  tree_size: number;
  root_hash: string;
  timestamp: string;
  kinds: ("signed" | "anchored" | "remembered")[];
  sth: SignedTreeHead | null;
  chain: string | null;
};
