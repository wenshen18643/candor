import "./globals.css";

import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from "next/font/google";
import Script from "next/script";
import type { ReactNode } from "react";

const hyperlegible = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--font-hyperlegible",
  display: "swap",
  adjustFontFallback: false,
});

const hyperlegibleMono = Atkinson_Hyperlegible_Mono({
  subsets: ["latin"],
  variable: "--font-hyperlegible-mono",
  display: "swap",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: { default: "Candor", template: "%s · Candor" },
  description:
    "Disclose wrongdoing without disclosing yourself. Zero-knowledge identity, on-device redaction, threshold encryption and a grounded evidence pipeline.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0b" },
  ],
};

const themeScript = `(()=>{try{const s=localStorage.getItem("candor-theme");const d=s?s==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.dataset.theme=d?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${hyperlegible.variable} ${hyperlegibleMono.variable}`}
    >
      <body className="bg-bg text-ink">
        <Script id="theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        {children}
      </body>
    </html>
  );
}
