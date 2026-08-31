"use client";

import { useEffect, useState } from "react";

import { CircleOff, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getRuntimeState, subscribeRuntimeState } from "@/lib/webmcp/registry";
import type { RuntimeState } from "@/lib/webmcp/registry";

/**
 * Surfaces the WebMCP availability reason in the main UI as soon as it is
 * known, so a judge never has to hunt through the Agent Actions panel (or
 * click Retry) to learn why agents are not connected.
 */
export function WebmcpStatusNotice({ onOpenActions }: { onOpenActions: () => void }) {
  const [runtime, setRuntime] = useState<RuntimeState | null>(() => getRuntimeState());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => subscribeRuntimeState(() => setRuntime(getRuntimeState())), []);

  if (!runtime || runtime.supported || dismissed) return null;

  const reason =
    runtime.reason === "no-api"
      ? "This browser does not expose the WebMCP API (document.modelContext), so no agent can drive this workspace through WebMCP."
      : "WebMCP tool registration did not complete in this browser.";

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-status-excluded/30 bg-status-excluded/5 px-3 py-2.5">
      <CircleOff className="size-4 shrink-0 text-status-excluded" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground/90">WebMCP not active</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{reason}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={onOpenActions}>
          Details &amp; tools
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss WebMCP notice"
          className="text-muted-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
