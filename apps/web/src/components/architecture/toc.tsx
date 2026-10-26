"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

export type TocItem = { id: string; label: string };

export function Toc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const threshold = window.innerHeight * 0.3;
      let current = items[0]?.id ?? "";
      for (const item of items) {
        const element = document.getElementById(item.id);
        if (element && element.getBoundingClientRect().top <= threshold) current = item.id;
      }
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      setActive(atBottom ? (items[items.length - 1]?.id ?? current) : current);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [items]);

  const list = (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            aria-current={active === item.id ? "location" : undefined}
            className={cn(
              "block rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150",
              active === item.id
                ? "bg-surface-2 font-medium text-ink"
                : "text-ink-2 hover:bg-surface hover:text-ink",
            )}
          >
            {item.label}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <nav aria-label="On this page" className="sticky top-6 hidden lg:block">
        <p className="mb-2 px-2.5 text-xs font-medium text-ink-3">On this page</p>
        {list}
      </nav>
      <details className="group rounded-lg border border-line lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          On this page
          <ChevronDown
            className="size-4 text-ink-2 transition-transform duration-200 group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <nav aria-label="On this page" className="border-t border-line px-1.5 py-2">
          {list}
        </nav>
      </details>
    </>
  );
}
