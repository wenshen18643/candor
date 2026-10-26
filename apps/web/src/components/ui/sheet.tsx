"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "md" | "lg";
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[1px] data-[state=open]:animate-[fade-in_160ms_var(--ease-out-quart)]" />
        <Dialog.Content
          className={cn(
            "shadow-pop fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-bg outline-none data-[state=open]:animate-[sheet-in_220ms_var(--ease-out-expo)]",
            width === "md" ? "sm:max-w-[480px]" : "sm:max-w-[640px]",
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-md font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-sm text-ink-2">
                  {description}
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">Details</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              className="-mr-1.5 inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink"
              aria-label="Close"
            >
              <X className="size-4" />
            </Dialog.Close>
          </header>
          <div className="scrollbar-quiet min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer ? <footer className="border-t border-line px-5 py-3">{footer}</footer> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
