"use client";

import { useEffect, useState } from "react";

import {
  Bot,
  CheckCircle2,
  CircleOff,
  ListOrdered,
  Play,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Spinner } from "@/components/ui/spinner";
import { formatActivityTime } from "@/lib/format";
import {
  type DemonstrationSummary,
  type RegisteredContract,
  type RuntimeState,
  type ToolCallRecord,
  discoverTools,
  ensureRegistered,
  getRuntimeState,
  getToolCalls,
  resetRegistration,
  runDemonstration,
  subscribeRuntimeState,
  subscribeToolCalls,
} from "@/lib/webmcp/registry";
import { cn } from "@/lib/utils";

export function WebmcpConsole({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [runtime, setRuntime] = useState<RuntimeState | null>(() => getRuntimeState());
  const [calls, setCalls] = useState<ToolCallRecord[]>(() => getToolCalls());
  const [discovered, setDiscovered] = useState<string[] | null>(null);
  const [demo, setDemo] = useState<DemonstrationSummary | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  useEffect(() => {
    const unsubscribeState = subscribeRuntimeState(() => setRuntime(getRuntimeState()));
    const unsubscribeCalls = subscribeToolCalls(() => setCalls(getToolCalls()));
    return () => {
      unsubscribeState();
      unsubscribeCalls();
    };
  }, []);

  const refreshDiscovery = async () => {
    setDiscovered(null);
    const list = await discoverTools();
    setDiscovered(list.map((tool) => tool.name).sort());
  };

  const runDemo = async () => {
    setDemoBusy(true);
    setDemo(null);
    try {
      setDemo(await runDemonstration());
    } catch (error) {
      setDemo({ ok: false, executed: [], skipped: [], error: messageOf(error) });
    } finally {
      setDemoBusy(false);
    }
  };

  const supported = runtime?.supported === true;
  const registeredCount = supported ? runtime.registered.length : 0;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-signal" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">Agent actions</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
              supported
                ? "bg-status-included/10 text-status-included"
                : runtime === null
                  ? "bg-muted text-muted-foreground"
                  : "bg-status-excluded/10 text-status-excluded",
            )}
          >
            {runtime === null ? "checking" : supported ? `${registeredCount} tools` : "no WebMCP"}
          </span>
        </div>
      }
    >
      <div className="space-y-5 p-5">
        <StatusBanner runtime={runtime} onRefresh={refreshDiscovery} />
        <RunDemoButton
          supported={supported}
          busy={demoBusy}
          recent={demo}
          onRun={runDemo}
          onClose={onClose}
        />
        <ToolsSection
          runtime={runtime}
          discovered={discovered}
          onRefreshDiscovery={refreshDiscovery}
        />
        <CallsFeed calls={calls} />
      </div>
    </Drawer>
  );
}

function StatusBanner({
  runtime,
  onRefresh,
}: {
  runtime: RuntimeState | null;
  onRefresh: () => void;
}) {
  if (runtime === null) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
        <Spinner className="size-3.5 animate-spin" aria-hidden="true" />
        Checking WebMCP support…
      </div>
    );
  }

  if (runtime.supported) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-status-included/30 bg-status-included/5 px-3 py-2.5">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-status-included" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground/90">
            WebMCP active — {runtime.registered.length} tools registered to document.modelContext.
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Agents discover them with getTools() and invoke them with executeTool() — each call
            shows up in the feed below, against the real EvidenceOS API.
          </p>
          {runtime.errors.length > 0 ? (
            <p className="mt-1 text-xs text-status-excluded">
              {runtime.errors.length} tool(s) could not be registered.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-status-excluded/30 bg-status-excluded/5 px-3 py-2.5">
      <CircleOff className="mt-0.5 size-4 shrink-0 text-status-excluded" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground/90">WebMCP unavailable</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{runtime.detail}</p>
        <Button
          variant="outline"
          size="xs"
          className="mt-2"
          onClick={() => {
            resetRegistration();
            void ensureRegistered();
            onRefresh();
          }}
        >
          <RefreshCw className="size-3" aria-hidden="true" />
          Re-check
        </Button>
      </div>
    </div>
  );
}

function RunDemoButton({
  supported,
  busy,
  recent,
  onRun,
  onClose,
}: {
  supported: boolean;
  busy: boolean;
  recent: DemonstrationSummary | null;
  onRun: () => void;
  onClose: () => void;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Demonstration workflow</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Runs all 8 tools in sequence through the real WebMCP surface — search, fetch, create a
            throwaway review, extract LLM evidence, compare papers, then clean up.
          </p>
        </div>
        <Button
          size="sm"
          disabled={!supported || busy}
          onClick={busy ? undefined : onRun}
          aria-label="Run the full WebMCP demonstration workflow"
        >
          {busy ? (
            <Spinner className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="size-3.5" aria-hidden="true" />
          )}
          {busy ? "Running…" : "Run workflow"}
        </Button>
      </div>
      {!supported ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Needs a WebMCP-capable browser to execute end to end.
        </p>
      ) : null}
      {recent ? (
        <div
          className={cn(
            "mt-2.5 rounded-md border px-2.5 py-2 text-xs",
            recent.ok
              ? "border-status-included/30 bg-status-included/5 text-foreground/80"
              : "border-status-excluded/30 bg-status-excluded/5 text-status-excluded",
          )}
        >
          {recent.ok
            ? `Workflow complete: ${recent.executed.length} tool calls ran.`
            : `Workflow failed: ${recent.error ?? "unknown error"}`}
          {recent.skipped.length > 0 ? ` Skipped: ${recent.skipped.join(", ")}.` : ""}{" "}
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer underline decoration-dotted underline-offset-2"
          >
            Watch the feed below.
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ToolsSection({
  runtime,
  discovered,
  onRefreshDiscovery,
}: {
  runtime: RuntimeState | null;
  discovered: string[] | null;
  onRefreshDiscovery: () => void;
}) {
  const available = runtime?.supported === true ? runtime.registered : [];

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ListOrdered className="size-3.5" aria-hidden="true" />
          Registered tools
        </h3>
        <button
          type="button"
          onClick={onRefreshDiscovery}
          className="flex cursor-pointer items-center gap-1 text-[0.6875rem] text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="size-3" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {available.length === 0 ? (
        <p className="rounded-md bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
          No tools are registered — WebMCP is not active in this browser.
        </p>
      ) : (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border">
          {available.map((entry) => (
            <ToolRow key={entry.name} entry={entry} />
          ))}
        </ul>
      )}

      {discovered !== null ? (
        <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">
          Browser reports {discovered.length} discoverable tool(s)
          {discovered.length > 0 ? `: ${discovered.join(", ")}` : ""}.
        </p>
      ) : null}
    </section>
  );
}

function ToolRow({ entry }: { entry: RegisteredContract }) {
  return (
    <li className="flex items-start gap-2.5 px-3 py-2">
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center",
          entry.registered ? "text-status-included" : "text-status-excluded",
        )}
      >
        {entry.registered ? (
          <CheckCircle2 className="size-4" aria-hidden="true" />
        ) : (
          <XCircle className="size-4" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <code className="text-xs font-medium">{entry.name}</code>
          {entry.readOnly ? (
            <Badge variant="soft" className="px-1.5 py-0 text-[0.625rem]">
              read-only
            </Badge>
          ) : null}
          {entry.registered ? null : (
            <Badge variant="excluded" className="px-1.5 py-0 text-[0.625rem]">
              not registered
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{entry.description}</p>
        {entry.error ? (
          <p className="mt-0.5 text-[0.6875rem] text-status-excluded">{entry.error}</p>
        ) : null}
      </div>
    </li>
  );
}

function CallsFeed({ calls }: { calls: ToolCallRecord[] }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Tool calls
      </h3>
      {calls.length === 0 ? (
        <p className="rounded-md bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
          No tool executions yet. Run the demonstration workflow, or invoke a tool from an agent
          connected over WebMCP.
        </p>
      ) : (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border">
          {calls.map((call) => (
            <CallRow key={call.id} call={call} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CallRow({ call }: { call: ToolCallRecord }) {
  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          {call.status === "running" ? (
            <Spinner className="size-3 animate-spin" aria-hidden="true" />
          ) : call.status === "ok" ? (
            <CheckCircle2 className="size-3.5 text-status-included" aria-hidden="true" />
          ) : (
            <XCircle className="size-3.5 text-status-excluded" aria-hidden="true" />
          )}
        </span>
        <code className="text-xs font-medium">{call.tool}</code>
        {call.source === "demo" ? (
          <Badge variant="signal" className="px-1.5 py-0 text-[0.625rem]">
            workflow
          </Badge>
        ) : null}
        <span className="ml-auto shrink-0 text-[0.6875rem] text-muted-foreground">
          {formatActivityTime(call.startedAt)}
        </span>
      </div>
      {call.status === "running" ? (
        <p className="mt-1 text-xs italic text-muted-foreground">Running…</p>
      ) : (
        <details className="group mt-1">
          <summary className="cursor-pointer list-none text-[0.6875rem] text-muted-foreground transition-colors hover:text-foreground">
            {call.status === "ok" ? "View output" : (call.error ?? "Failed")}
          </summary>
          <pre className="mt-1.5 max-h-56 overflow-auto rounded-md bg-muted/50 px-2.5 py-2 text-[0.6875rem] leading-relaxed whitespace-pre-wrap">
            {call.status === "ok" ? (call.result ?? "") : (call.error ?? "")}
          </pre>
        </details>
      )}
    </li>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
