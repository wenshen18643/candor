"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function MobileNav({ links }: { links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="lg:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </Button>
      <nav
        id={panelId}
        aria-label="Primary"
        hidden={!open}
        className="absolute inset-x-3 top-[calc(100%-4px)] z-30 rounded-lg border border-line bg-bg p-1.5 shadow-[0_8px_8px_-6px_oklch(0_0_0/0.18)]"
      >
        <ul className="flex flex-col">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={cn(
                  "flex h-11 items-center rounded-md px-3 text-md transition-colors duration-150",
                  pathname.startsWith(link.href)
                    ? "bg-surface-2 font-medium text-ink"
                    : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                )}
              >
                {link.label}
              </Link>
            </li>
          ))}
          <li className="mt-1 border-t border-line pt-1">
            <Link
              href="/report/northwind-ethics"
              className="flex h-11 items-center rounded-md px-3 text-md font-medium text-seal-ink hover:bg-seal-soft"
            >
              Make a report
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
