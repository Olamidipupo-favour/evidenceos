import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const variants = {
  default: "bg-foreground/[0.06] text-foreground",
  soft: "bg-muted text-muted-foreground",
  signal: "bg-signal-soft text-signal",
  included: "bg-status-included-soft text-status-included",
  screened: "bg-status-screened-soft text-status-screened",
  pending: "bg-status-pending-soft text-status-pending",
  excluded: "bg-status-excluded-soft text-status-excluded",
} as const;

export function Badge({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof variants }) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium leading-5",
        "whitespace-nowrap border border-transparent",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
