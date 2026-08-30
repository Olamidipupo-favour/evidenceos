/**
 * WebMCP registration and visibility layer for the EvidenceOS workspace.
 *
 * Feature-detects `document.modelContext` (no-op when the browser has no
 * WebMCP), registers the eight EvidenceOS tools, and mirrors every execution
 * — whether invoked by an external agent or by this page's own demonstration
 * workflow — into the Agent Actions feed.
 */

import {
  getModelContext,
  getTool,
  isValidToolName,
  tools,
  type RegisteredTool,
  type ToolContract,
  type WebMCPTool,
} from "@evidenceos/webmcp";

import { runToolExecutor } from "@/lib/webmcp/executors";
import { ToolArgumentError, validateInput } from "@/lib/webmcp/validate";

export { getModelContext };
export type { RegisteredTool, ToolContract };

const MAX_CALLS = 60;
const DEMO_REVIEW_TITLE = "WebMCP demonstration";

export type ToolCallSource = "executeTool" | "demo";
export type ToolCallStatus = "running" | "ok" | "error";

export interface ToolCallRecord {
  id: string;
  tool: string;
  source: ToolCallSource;
  status: ToolCallStatus;
  startedAt: string;
  finishedAt: string | null;
  input: Readonly<Record<string, unknown>> | null;
  result: string | null;
  error: string | null;
}

export interface RegisteredContract {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  untrustedContent: boolean;
  registered: boolean;
  error: string | null;
}

export type RuntimeState =
  | { supported: true; registered: RegisteredContract[]; errors: string[] }
  | { supported: false; reason: "no-api" | "registration-failed"; detail: string };

export interface DemonstrationSummary {
  ok: boolean;
  executed: string[];
  skipped: string[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// Call feed
// ---------------------------------------------------------------------------

let calls: ToolCallRecord[] = [];
const callListeners = new Set<() => void>();
let callSeq = 0;

function nextCallId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  callSeq += 1;
  return `tool-${callSeq}-${Date.now()}`;
}

function now(): string {
  return new Date().toISOString();
}

function publishCalls(): void {
  for (const listener of [...callListeners]) listener();
}

function pushCall(
  partial: Omit<ToolCallRecord, "id" | "startedAt" | "finishedAt" | "result" | "error">,
): ToolCallRecord {
  const record: ToolCallRecord = {
    ...partial,
    id: nextCallId(),
    startedAt: now(),
    finishedAt: null,
    result: null,
    error: null,
  };
  calls = [record, ...calls].slice(0, MAX_CALLS);
  publishCalls();
  return record;
}

function updateCall(id: string, patch: Partial<ToolCallRecord>): void {
  let changed = false;
  calls = calls.map((call) => {
    if (call.id !== id) return call;
    changed = true;
    return { ...call, ...patch };
  });
  if (changed) publishCalls();
}

export function getToolCalls(): ToolCallRecord[] {
  return calls;
}

export function subscribeToolCalls(listener: () => void): () => void {
  callListeners.add(listener);
  return () => {
    callListeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

let runtimeState: RuntimeState | null = null;
let registering: Promise<RuntimeState> | null = null;
const stateListeners = new Set<() => void>();
const registrationController = new AbortController();

const NO_API_DETAIL =
  "This browser does not expose the WebMCP API (document.modelContext), so agents " +
  "cannot connect through WebMCP here — the human UI remains fully functional. " +
  "WebMCP needs Chromium 146+ with the origin trial or the #enable-webmcp-testing flag " +
  "in a secure, origin-keyed document.";

function publishState(): void {
  for (const listener of [...stateListeners]) listener();
}

function setRuntimeState(next: RuntimeState): RuntimeState {
  runtimeState = next;
  publishState();
  return next;
}

export function getRuntimeState(): RuntimeState | null {
  return runtimeState;
}

export function subscribeRuntimeState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

export async function discoverTools(): Promise<RegisteredTool[]> {
  const ctx = getModelContext();
  if (!ctx) return [];
  return ctx.getTools();
}

/** Forget registration results so the next `ensureRegistered()` retries. */
export function resetRegistration(): void {
  runtimeState = null;
  registering = null;
  publishState();
}

/** Wipe recorded calls and registration state (tests, retry flows). */
export function resetRegistry(): void {
  calls = [];
  runtimeState = null;
  registering = null;
  publishCalls();
  publishState();
}

/**
 * Register every EvidenceOS tool with the browser's WebMCP surface. Safe to
 * call anywhere: resolves immediately on a second call, and no-ops cleanly on
 * browsers without WebMCP.
 */
export function ensureRegistered(): Promise<RuntimeState> {
  if (runtimeState) return Promise.resolve(runtimeState);
  if (registering) return registering;

  registering = (async () => {
    const ctx = getModelContext();
    if (!ctx) {
      return setRuntimeState({ supported: false, reason: "no-api", detail: NO_API_DETAIL });
    }

    if (typeof ctx.addEventListener === "function") {
      ctx.addEventListener("toolchange", () => publishState());
    }

    const contracts: RegisteredContract[] = [];
    for (const contract of tools) {
      const entry: RegisteredContract = {
        name: contract.name,
        title: contract.title,
        description: contract.description,
        readOnly: contract.annotations?.readOnlyHint ?? false,
        untrustedContent: contract.annotations?.untrustedContentHint ?? false,
        registered: false,
        error: null,
      };

      try {
        if (!isValidToolName(contract.name)) {
          throw new ToolArgumentError(`Invalid WebMCP tool name "${contract.name}"`);
        }
        await ctx.registerTool(buildTool(contract), { signal: registrationController.signal });
        entry.registered = true;
      } catch (error) {
        const message = errorMessage(error);
        // The name may already be held from a previous page lifecycle (HMR);
        // treat that as registered rather than failing the batch.
        if (/already|registered|duplicate/i.test(message)) {
          entry.registered = true;
          entry.error = "Already registered (re-registered over a previous lifecycle).";
        } else {
          entry.error = message;
        }
      }
      contracts.push(entry);
    }

    const registeredCount = contracts.filter((entry) => entry.registered).length;
    if (registeredCount === 0) {
      return setRuntimeState({
        supported: false,
        reason: "registration-failed",
        detail: contracts
          .map((entry) => `${entry.name}: ${entry.error ?? "registration failed"}`)
          .join("; "),
      });
    }

    const errors = contracts
      .filter((entry) => !entry.registered)
      .map((entry) => `${entry.name}: ${entry.error}`);
    return setRuntimeState({ supported: true, registered: contracts, errors });
  })();

  return registering;
}

// ---------------------------------------------------------------------------
// Tool execution + visibility
// ---------------------------------------------------------------------------

function buildTool(contract: ToolContract): WebMCPTool {
  return {
    name: contract.name,
    title: contract.title,
    description: contract.description,
    inputSchema: contract.inputSchema,
    annotations: contract.annotations,
    execute: (input, { signal }) => executeLogged(contract, input, signal),
  };
}

async function executeLogged(
  contract: ToolContract,
  input: unknown,
  signal: AbortSignal,
): Promise<string> {
  let record: ToolCallRecord | null = null;

  try {
    const args = coerceInput(input);
    record = pushCall({
      tool: contract.name,
      source: "executeTool",
      status: "running",
      input: args,
    });

    validateInput(contract.inputSchema, args);
    const value = await runToolExecutor(contract.name, args, { signal });
    const serialized = serializeResult(value);
    updateCall(record.id, { status: "ok", result: serialized, finishedAt: now() });
    return serialized;
  } catch (error) {
    const message = errorMessage(error);
    if (record) updateCall(record.id, { status: "error", error: message, finishedAt: now() });
    throw error instanceof Error ? error : new Error(message);
  }
}

/**
 * Normalise the tool-input slot to a plain object. The WebMCP algorithm hands
 * `execute` a structured object, but agents ported from the Chrome MCP docs may
 * instead pass a JSON-encoded string — accept both.
 */
function coerceInput(input: unknown): Record<string, unknown> {
  if (input == null) return {};
  if (typeof input === "string") {
    try {
      const parsed: unknown = JSON.parse(input);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      throw new ToolArgumentError("Malformed input. Expected a JSON object of tool arguments.");
    }
    return {};
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new ToolArgumentError("Malformed input. Expected a JSON object of tool arguments.");
  }
  return input as Record<string, unknown>;
}

/** Serialize an executor result to the string the browser returns. */
export function serializeResult(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error instanceof ToolArgumentError || error.name === "ToolArgumentError") {
      return `Argument validation failed: ${error.message}`;
    }
    return error.message;
  }
  return String(error);
}

// ---------------------------------------------------------------------------
// Demonstration workflow (real WebMCP, end to end)
// ---------------------------------------------------------------------------

/**
 * Run every EvidenceOS tool once, sequentially, through the browser's real
 * WebMCP surface (`getTools()` → `executeTool()`). Interleaves read-only and
 * mutating steps so the whole workflow demonstrably works; a throwaway review
 * is created, populated, extracted against, and cleaned up afterwards.
 */
export async function runDemonstration(): Promise<DemonstrationSummary> {
  const ctx = getModelContext();
  if (!ctx || !runtimeState || runtimeState.supported !== true) {
    throw new Error(
      runtimeState?.supported === false
        ? runtimeState.detail
        : "WebMCP is not available in this browser.",
    );
  }

  const registered = await ctx.getTools();
  const byName = new Map(registered.map((tool) => [tool.name, tool]));
  const resolveTool = (name: string): RegisteredTool => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`Tool "${name}" is not registered with the browser.`);
    return tool;
  };

  const exec = async (name: string, input: Record<string, unknown>): Promise<unknown> => {
    const raw = await ctx.executeTool(resolveTool(name), JSON.stringify(input));
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  const record = pushCall({
    tool: "workflow",
    source: "demo",
    status: "running",
    input: { name: "WebMCP demonstration workflow" },
  });

  const executed: string[] = [];
  const skipped: string[] = [];

  try {
    const search = (await exec("search_literature", {
      query: "metformin type 2 diabetes",
      page_size: 6,
    })) as { papers?: Array<{ pmid?: number }> } | null;
    executed.push("search_literature");

    const papers = search?.papers ?? [];
    const primary = papers[0]?.pmid;
    if (typeof primary !== "number") {
      throw new Error("search_literature returned no papers to demonstrate the workflow with.");
    }

    await exec("get_paper", { reference: primary });
    executed.push("get_paper");

    const created = (await exec("create_review", {
      title: DEMO_REVIEW_TITLE,
      research_question: "Demonstration run of the EvidenceOS WebMCP workflow",
    })) as { review?: { id?: string } } | null;
    executed.push("create_review");

    const reviewId = created?.review?.id;
    if (!reviewId) {
      throw new Error("create_review returned no review UUID.");
    }

    const added = (await exec("add_paper_to_review", {
      review_id: reviewId,
      pmid: primary,
      status: "included",
    })) as { paper?: { paper_id?: string } } | null;
    executed.push("add_paper_to_review");
    const paperId = added?.paper?.paper_id;

    try {
      await exec("extract_evidence", { reference: primary });
      executed.push("extract_evidence");
    } catch {
      skipped.push("extract_evidence");
    }

    await exec("get_evidence_matrix", { review_id: reviewId });
    executed.push("get_evidence_matrix");

    const secondary = papers.find((paper) => paper.pmid !== primary)?.pmid;
    if (typeof secondary === "number") {
      await exec("compare_papers", { references: [primary, secondary] });
      executed.push("compare_papers");
    } else {
      skipped.push("compare_papers");
    }

    if (paperId) {
      await exec("remove_paper_from_review", { review_id: reviewId, paper_id: paperId });
      executed.push("remove_paper_from_review");
    }

    const summary: DemonstrationSummary = { ok: true, executed, skipped, error: null };
    updateCall(record.id, {
      status: "ok",
      finishedAt: now(),
      result: serializeResult({
        ...summary,
        note: `A "${DEMO_REVIEW_TITLE}" review was left in the workspace — delete it from the UI when done.`,
      }),
    });
    return summary;
  } catch (error) {
    const message = errorMessage(error);
    updateCall(record.id, { status: "error", error: message, finishedAt: now() });
    return { ok: false, executed, skipped, error: message };
  }
}

export { tools as TOOL_CONTRACTS, getTool as getToolContract };
