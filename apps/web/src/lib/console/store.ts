"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { showcaseMode } from "@/lib/config";
import type { PseudonymEntry } from "@/lib/types";

import { showcaseClient } from "./showcase";
import type { ConsoleClient, ReviewerIdentity, UnlockedEvidence } from "./types";

type ConsoleState = {
  client: ConsoleClient;
  identity: ReviewerIdentity | null;
  unlocked: Record<string, UnlockedEvidence>;
  reidentify: Record<string, boolean>;
  hydrated: boolean;
  setIdentity: (identity: ReviewerIdentity | null) => void;
  setUnlocked: (reportId: string, evidence: UnlockedEvidence) => void;
  setReidentify: (reportId: string, value: boolean) => void;
  setClient: (client: ConsoleClient) => void;
};

export const useConsole = create<ConsoleState>()(
  persist(
    (set) => ({
      client: showcaseMode
        ? showcaseClient
        : new Proxy(showcaseClient, {
            get: (_target, property: keyof ConsoleClient) =>
              property === "mode"
                ? "live"
                : typeof _target[property] === "function"
                  ? (...args: unknown[]) =>
                      import("./live").then(({ liveClient }) =>
                        Reflect.apply(liveClient[property], liveClient, args),
                      )
                  : undefined,
          }),
      identity: null,
      unlocked: {},
      reidentify: {},
      hydrated: false,
      setIdentity: (identity) => set({ identity }),
      setUnlocked: (reportId, evidence) =>
        set((state) => ({
          unlocked: { ...state.unlocked, [reportId]: evidence },
          reidentify: { ...state.reidentify, [reportId]: true },
        })),
      setReidentify: (reportId, value) =>
        set((state) => ({ reidentify: { ...state.reidentify, [reportId]: value } })),
      setClient: (client) => set({ client }),
    }),
    {
      name: "candor-console",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ identity: state.identity }),
      skipHydration: true,
      onRehydrateStorage: () => () => {
        useConsole.setState({ hydrated: true });
      },
    },
  ),
);

export function usePseudonymMap(reportId: string): PseudonymEntry[] | null {
  return useConsole((state) =>
    state.reidentify[reportId] ? (state.unlocked[reportId]?.pseudonymMap ?? null) : null,
  );
}

export const isShowcase = showcaseMode;
