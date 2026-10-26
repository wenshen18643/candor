"use client";

import type { Detection, LeakageReport, ScrubResult, StrippedFile } from "@candor/privacy";
import { create } from "zustand";

import type {
  BlindToken,
  CampaignInfo,
  Receipt,
  SealStep,
  SelfSession,
  VerificationResult,
} from "./types";

export type StepId = "intro" | "verify" | "evidence" | "review" | "seal" | "receipt";

export const stepOrder: StepId[] = ["intro", "verify", "evidence", "review", "seal", "receipt"];

export type Action = "pseudonymise" | "redact" | "keep";

export type MintTrace = { blinded: string[]; signatures: string[] };

type ReporterState = {
  step: StepId;
  campaign: CampaignInfo | null;
  session: SelfSession | null;
  verification: VerificationResult | null;
  tokens: BlindToken[];
  mintTrace: MintTrace | null;
  statement: string;
  selfTerms: string[];
  rawFiles: File[];
  files: StrippedFile[];
  docs: { docKey: string; text: string }[];
  detections: Detection[];
  decisions: Record<string, Action>;
  variants: ("original" | "redacted")[];
  scrubbed: ScrubResult | null;
  leakage: LeakageReport | null;
  sealSteps: SealStep[];
  receipt: Receipt | null;
  setStep: (step: StepId) => void;
  patch: (values: Partial<ReporterState>) => void;
  setDecision: (detectionId: string, action: Action) => void;
  addSealStep: (step: SealStep) => void;
  reset: () => void;
};

const initial = {
  step: "intro" as StepId,
  campaign: null,
  session: null,
  verification: null,
  tokens: [],
  mintTrace: null,
  statement: "",
  selfTerms: [],
  rawFiles: [],
  files: [],
  docs: [],
  detections: [],
  decisions: {},
  variants: [],
  scrubbed: null,
  leakage: null,
  sealSteps: [],
  receipt: null,
};

export const useReporter = create<ReporterState>()((set) => ({
  ...initial,
  setStep: (step) => set({ step }),
  patch: (values) => set(values),
  setDecision: (detectionId, action) =>
    set((state) => ({ decisions: { ...state.decisions, [detectionId]: action } })),
  addSealStep: (step) => set((state) => ({ sealSteps: [...state.sealSteps, step] })),
  reset: () => set((state) => ({ ...initial, campaign: state.campaign })),
}));
