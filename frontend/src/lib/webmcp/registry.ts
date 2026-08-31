/**
 * WebMCP registration and visibility layer for the EvidenceOS workspace.
 *
 * Feature-detects `document.modelContext` (no-op when the browser has no
 * WebMCP), registers the eight EvidenceOS tools, and mirrors every execution
 * Tool executions are mirrored — whether invoked by an external agent or by this
 * page's own agent orchestrator run — into the Agent Actions feed.
 */

import {
  getModelContext,
  getTool,
  isValidToolName,
  tools,
  type ModelContext,
  type RegisteredTool,
  type ToolContract,
  type WebMCPTool,
} from "@evidenceos/webmcp";

import { api } from "@/lib/api";
import { runAgentWorkflow, type AgentFeed } from "@/lib/webmcp/agent";
import { runToolExecutor } from "@/lib/webmcp/executors";
import { ToolArgumentError, validateInput } from "@/lib/webmcp/validate";

export { getModelContext };
export type { RegisteredTool, ToolContract };
export { abortRunningAgent, isAgentRunning } from "@/lib/webmcp/agent";

const MAX_CALLS = 60;
const DEMO_REVIEW_TITLE = "WebMCP demonstration";

/**
 * Registration must never hang the Agent Actions panel: if the browser's
 * WebMCP surface swallows a `registerTool()` call (e.g. the document is not an
 * origin-keyed agent cluster), settle on a `registration-failed` state instead
 * of leaving the UI on "Checking WebMCP support…" forever.
 */
const REGISTRATION_TIMEOUT_MS = 10_000;
const TOOL_REGISTRATION_TIMEOUT_MS = 3_000;

/** Race a promise against a hard timeout; late resolutions are ignored. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type ToolCallSource = "executeTool" | "demo";
export type ToolCallStatus = "running" | "ok" | "error";
export type ToolCallKind = "tool" | "thought";

export interface ToolCallRecord {
  id: string;
  kind: ToolCallKind;
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
  steps?: number;
  thoughts?: number;
  summary?: string | null;
}

// ---------------------------------------------------------------------------
// Call feed
// ---------------------------------------------------------------------------

let calls: ToolCallRecord[] = [];
const callListeners = new Set<() => void>();
let callSeq = 0;

/**
 * Source tag for executions started by this page's own orchestrator run so
 * its tool rows carry the "workflow" badge in the feed, matching the summary
 * row, instead of looking like unlabelled external calls.
 */
let activeToolSource: ToolCallSource = "executeTool";

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

type PushCallArgs = Omit<ToolCallRecord, "id" | "startedAt" | "finishedAt" | "error" | "result"> &
  Partial<Pick<ToolCallRecord, "result">>;

function pushCall(partial: PushCallArgs): ToolCallRecord {
  const record: ToolCallRecord = {
    ...partial,
    id: nextCallId(),
    startedAt: now(),
    finishedAt: null,
    result: partial.result ?? null,
    error: null,
  };
  calls = [record, ...calls].slice(0, MAX_CALLS);
  publishCalls();
  return record;
}

/** Add a real-time "agent is thinking…" row to the feed. */
function pushThought(initial: string): ToolCallRecord {
  const record = pushCall({
    kind: "thought",
    tool: "thought",
    source: "demo",
    status: initial ? "ok" : "running",
    input: null,
    result: initial || null,
  });
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
let registrationController = new AbortController();

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
  registrationController.abort();
  registrationController = new AbortController();
  runtimeState = null;
  registering = null;
  publishState();
}

/** Wipe recorded calls and registration state (tests, retry flows). */
export function resetRegistry(): void {
  registrationController.abort();
  registrationController = new AbortController();
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
    let ctx: ModelContext | null = null;
    try {
      ctx = getModelContext();
    } catch (error) {
      // A WebMCP shim whose `document.modelContext` getter throws must never
      // leave the panel hanging on "Checking…" — surface why it failed.
      return setRuntimeState({
        supported: false,
        reason: "registration-failed",
        detail: `The WebMCP API could not be read: ${errorMessage(error)}`,
      });
    }

    if (!ctx) {
      return setRuntimeState({ supported: false, reason: "no-api", detail: NO_API_DETAIL });
    }

    // A partial shim may expose the context but not event hooks; the app still
    // attempts registration either way.
    try {
      if (typeof ctx.addEventListener === "function") {
        ctx.addEventListener("toolchange", () => publishState());
      }
    } catch {
      // No event hooks — registration below is still attempted.
    }

    try {
      return await withTimeout(registerTools(ctx), REGISTRATION_TIMEOUT_MS, "WebMCP registration");
    } catch (error) {
      return setRuntimeState({
        supported: false,
        reason: "registration-failed",
        detail:
          "The browser did not settle WebMCP tool registration." +
          ` ${errorMessage(error)}.` +
          " This can happen when Chromium does not see an origin-keyed agent " +
          "cluster — the document needs Cross-Origin-Opener-Policy: same-origin " +
          "— or when an agent is confirming each tool grant. Re-check attempts again.",
      });
    }
  })();

  return registering;
}

async function registerTools(ctx: ModelContext): Promise<RuntimeState> {
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
      await withTimeout(
        ctx.registerTool(buildTool(contract), { signal: registrationController.signal }),
        TOOL_REGISTRATION_TIMEOUT_MS,
        `registerTool("${contract.name}")`,
      );
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
    execute: (input, context) => executeLogged(contract, input, context?.signal),
  };
}

async function executeLogged(
  contract: ToolContract,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<string> {
  let record: ToolCallRecord | null = null;

  try {
    const args = coerceInput(input);
    record = pushCall({
      kind: "tool",
      tool: contract.name,
      source: activeToolSource,
      status: "running",
      input: args,
    });

    validateInput(contract.inputSchema, args);
    const value = await runToolExecutor(contract.name, args, { signal });
    const serialized = serializeResult(value);
    updateCall(record.id, { status: "ok", result: serialized, finishedAt: now() });
    announceToolActivity(contract.name, "ok", null);
    return serialized;
  } catch (error) {
    const message = errorMessage(error);
    if (record) updateCall(record.id, { status: "error", error: message, finishedAt: now() });
    announceToolActivity(contract.name, "error", message);
    throw error instanceof Error ? error : new Error(message);
  }
}

/**
 * Mirror a tool execution into the human "Agent activity" panel so agent
 * actions stay visible in real time alongside manual UI actions. The workspace
 * store listens for this event and appends a styled entry.
 */
function announceToolActivity(tool: string, status: "ok" | "error", detail: string | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("evidenceos:tool-activity", { detail: { tool, status, detail } }),
  );
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
 * Run an LLM-driven agent through the browser's real WebMCP surface
 * (`getTools()` → `executeTool()`). The agent reasons aloud — its thoughts are
 * streamed into the Agent Actions feed token by token — and decides each tool
 * call itself; the orchestrator only validates and executes the choice. The
 * agent operates on the review currently active in the workspace, searching
 * with its research question, and only creates a review when none exists.
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

  const exec = async (name: string, input: Record<string, unknown>): Promise<string> => {
    const raw = await ctx.executeTool(resolveTool(name), JSON.stringify(input));
    // When the planner decides to create a review, make it active in the
    // visible workspace so the judge watches its matrix fill up live.
    if (name === "create_review" && typeof window !== "undefined") {
      try {
        const parsed: unknown = JSON.parse(raw ?? "{}");
        const reviewId =
          parsed && typeof parsed === "object" && "review" in parsed
            ? (parsed as { review?: { id?: string } }).review?.id
            : undefined;
        if (reviewId) {
          window.dispatchEvent(
            new CustomEvent("evidenceos:select-review", { detail: { reviewId } }),
          );
        }
      } catch {
        // Non-fatal: the workspace still picks up the new review on next refresh.
      }
    }
    return raw ?? "null";
  };

  const { reviewTitle, context } = await readActiveReviewContext();

  const record = pushCall({
    kind: "tool",
    tool: "workflow",
    source: "demo",
    status: "running",
    input: { name: "Agent orchestrator run" },
  });

  const feed: AgentFeed = {
    beginThought: () => pushThought("").id,
    updateThought: (id, text) => updateCall(id, { result: text }),
    resolveThought: (id, status) =>
      updateCall(id, {
        status,
        finishedAt: status === "ok" ? now() : null,
        error: status === "error" ? "The planner could not decide this step." : null,
      }),
  };

  activeToolSource = "demo";
  try {
    const outcome = await runAgentWorkflow({
      tools: tools.map((contract) => ({
        name: contract.name,
        description: contract.description,
        parameters: contract.inputSchema,
        read_only: contract.annotations?.readOnlyHint ?? false,
      })),
      context,
      feed,
      execute: exec,
    });

    const summary: DemonstrationSummary = {
      ok: true,
      executed: outcome.executed,
      skipped: outcome.skipped,
      error: null,
      steps: outcome.steps,
      thoughts: outcome.thoughts.length,
      summary: outcome.summary,
    };
    updateCall(record.id, {
      status: "ok",
      finishedAt: now(),
      result: serializeResult({
        ...summary,
        note: summaryNote(reviewTitle, outcome.executed),
      }),
    });
    return summary;
  } catch (error) {
    const isStop = error instanceof Error && /Stopped by the user/i.test(error.message);
    const message = errorMessage(error);
    updateCall(record.id, {
      status: isStop ? "error" : "error",
      finishedAt: now(),
      error: message,
    });
    return { ok: false, executed: [], skipped: [], error: message };
  } finally {
    activeToolSource = "executeTool";
  }
}

/**
 * Read the workspace's persisted active review and shape the planner context:
 * which review to work inside, its research question, and whether a fresh
 * review must be created.
 */
async function readActiveReviewContext(): Promise<{
  reviewTitle: string | null;
  context: { goal: string; context: string };
}> {
  let reviewTitle: string | null = null;
  let researchQuestion: string | null = null;
  let reviewId: string | null = null;
  const persisted = readActiveReviewId();
  if (persisted) {
    try {
      const matrix = await api.getReviewMatrix(persisted);
      reviewId = matrix.review.id;
      reviewTitle = matrix.review.title;
      researchQuestion = matrix.review.research_question;
    } catch {
      // The stored review no longer exists — the planner may create one.
    }
  }

  const goal =
    "Run the EvidenceOS evidence workflow end to end for a systematic review: find " +
    "candidate studies, pick a primary study, capture it into the review, extract evidence " +
    "for it, confirm the evidence matrix reflects it, compare a second paper, and remove the " +
    "redundant paper so the review stays clean. Work inside the active review when one is " +
    "given — never create a new review in that case.";

  const context = reviewId
    ? `Active review: "${reviewTitle}" (id: ${reviewId}).\n` +
      `Research question: ${researchQuestion ?? "(none stated)"}.`
    : "No review exists yet — create one with create_review before adding papers.\n" +
      `Research question: ${researchQuestion ?? "metformin type 2 diabetes"}.`;

  return { reviewTitle, context: { goal, context } };
}

function summaryNote(reviewTitle: string | null, executed: string[]): string {
  if (reviewTitle) return `Ran against the active review "${reviewTitle}".`;
  if (executed.includes("create_review")) {
    return `A "${DEMO_REVIEW_TITLE}" review was created and is now active — delete it from the UI when done.`;
  }
  return "End-to-end agent run complete.";
}

/** Read the workspace's persisted active review id without importing the UI. */
function readActiveReviewId(): string | null {
  try {
    return window.localStorage.getItem("evidenceos:activeReviewId");
  } catch {
    return null;
  }
}

export { tools as TOOL_CONTRACTS, getTool as getToolContract };
