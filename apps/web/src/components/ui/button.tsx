import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-[background-color,color,border-color,opacity] duration-150 ease-out select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-seal text-on-seal hover:bg-seal-hover active:bg-seal-hover",
        secondary:
          "border border-line-strong bg-bg text-ink hover:bg-surface-2 active:bg-surface-3",
        ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink active:bg-surface-3",
        quiet: "bg-surface-2 text-ink hover:bg-surface-3",
        danger:
          "border border-contradicted/40 bg-bg text-contradicted hover:bg-contradicted-soft active:bg-contradicted-soft",
        link: "h-auto px-0 text-seal-ink underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2.5 text-sm",
        md: "h-9 px-3.5 text-base",
        lg: "h-11 px-5 text-md",
        icon: "size-8",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean };

export function Button({
  className,
  variant,
  size,
  asChild,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </Component>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-4 animate-spin", className)}
      aria-hidden="true"
      fill="none"
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export { buttonVariants };
