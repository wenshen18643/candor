import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ConsoleShell } from "@/components/console/shell";

export const metadata: Metadata = { title: "Reviewer console" };

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
