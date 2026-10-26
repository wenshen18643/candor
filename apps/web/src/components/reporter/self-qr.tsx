"use client";

import { SelfAppBuilder, SelfQRcodeWrapper } from "@selfxyz/qrcode";
import { useMemo } from "react";

import type { SelfSession } from "@/lib/reporter/types";

export default function SelfQr({
  session,
  onScanned,
  onError,
}: {
  session: SelfSession;
  onScanned: () => void;
  onError: (reason: string) => void;
}) {
  const app = useMemo(
    () =>
      new SelfAppBuilder({
        appName: "Candor",
        scope: session.scope,
        endpoint: session.endpoint,
        endpointType: session.mode === "mainnet" ? "https" : "staging_https",
        chainID: session.mode === "mainnet" ? 42220 : 11142220,
        userId: session.userId,
        userIdType: "uuid",
        version: 2,
        disclosures: { minimumAge: 18, ofac: true, nationality: false, excludedCountries: [] },
      }).build(),
    [session],
  );
  return (
    <SelfQRcodeWrapper
      selfApp={app}
      onSuccess={onScanned}
      onError={({ reason }: { reason?: string }) => onError(reason ?? "verification_failed")}
      size={240}
    />
  );
}
