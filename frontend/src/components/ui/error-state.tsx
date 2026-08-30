import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className,
  compact = false,
}: ErrorStateProps) {
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/[0.04] px-6 text-center",
        compact ? "py-6" : "py-10",
        className,
      )}
    >
      <div className="flex size-9 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-4" aria-hidden="true" />
      </div>
      <div className="space-y-0.5">
        <h4 className="text-sm font-semibold tracking-tight">{title}</h4>
        <p className="mx-auto max-w-sm text-[0.8125rem] leading-relaxed text-muted-foreground">
          {message}
        </p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
