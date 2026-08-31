/**
 * The agent orchestrator that powers the "Run agent" workflow demo.
 *
 * Instead of replaying a hardcoded tool order, an LLM planner decides each
 * step: it reasons aloud (streamed token by token to the feed so the user
 * watches it think), then emits a single structured decision choosing exactly
 * one EvidenceOS tool. The orchestrator validates the decision, executes the
 * tool through the real WebMCP surface, appends the result to the planner's
 * transcript, and loops until the planner says it is done.
 *
 * The planner talks to the backend's `POST /api/agent/think` endpoint, which
 * streams newline-delimited SSE events. Failures and unknown/illegal tool
 * choices are fed back to the planner as tool errors so it can adapt, never
 * silently swallowed. A step cap keeps runaway loops bounded.
 */

import { API_URL } from "@/lib/api";
import { validateInput } from "@/lib/webmcp/validate";

const MAX_STEPS = 12;

export interface AgentToolInfo {
  name: string;
  description: string;
  parameters: unknown;
  read_only: boolean;
}

export interface AgentMessage {
  role: "assistant" | "tool";
  content: string;
  tool_call_id?: string | null;
}

export interface AgentDecision {
  done: boolean;
  tool?: string | null;
  arguments?: Readonly<Record<string, unknown>>;
  summary?: string | null;
}

export interface AgentContext {
  goal: string;
  context: string;
}

export type AgentStreamEvent =
  | { type: "thought"; text: string }
  | { type: "decision"; decision: AgentDecision }
  | { type: "error"; message: string };

export interface AgentOutcome {
  executed: string[];
  skipped: string[];
  steps: number;
  thoughts: string[];
  summary: string | null;
}

/** Feed callbacks let the registry append streaming rows without a cyclic import. */
export interface AgentFeed {
  beginThought(): string;
  updateThought(id: string, text: string): void;
  resolveThought(id: string, status: "ok" | "error"): void;
}

export interface AgentRunOptions {
  tools: AgentToolInfo[];
  context: AgentContext;
  feed: AgentFeed;
  /** Execute a chosen tool through WebMCP; resolve with the output string. */
  execute: (tool: string, args: Record<string, unknown>) => Promise<string>;
}

export class AgentFailure extends Error {}

export class AgentStopped extends Error {}

let runningAbort: AbortController | null = null;

/** Cancel the currently running agent workflow (Stop button). */
export function abortRunningAgent(): void {
  runningAbort?.abort();
}

/** Single source of truth for whether a run is active (Stop button visibility). */
export function isAgentRunning(): boolean {
  return runningAbort !== null;
}

async function* streamAgentEvents(
  body: AgentThinkRequest,
  signal: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/agent/think`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw new AgentStopped("Stopped by the user.");
    throw new AgentFailure(`Cannot reach the EvidenceOS planner: ${errorMessage(error)}`);
  }

  if (!response.ok) {
    let detail = `The planner request failed with HTTP ${response.status}.`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail) detail = body.detail;
    } catch {
      // keep the HTTP fallback message
    }
    throw new AgentFailure(detail);
  }
  if (!response.body) throw new AgentFailure("The planner returned an empty stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const sep = buffer.indexOf("\n\n");
        if (sep < 0) break;
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = parseSseFrame(frame);
        if (event) yield event;
      }
    }
    if (buffer) {
      const event = parseSseFrame(buffer);
      if (event) yield event;
    }
  } catch (error) {
    if (signal.aborted) throw new AgentStopped("Stopped by the user.");
    throw error;
  } finally {
    reader.releaseLock();
  }
}

interface AgentThinkRequest {
  goal: string;
  context: string;
  tools: AgentToolInfo[];
  messages: AgentMessage[];
}

function parseSseFrame(frame: string): AgentStreamEvent | null {
  for (const line of frame.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      return JSON.parse(payload) as AgentStreamEvent;
    } catch {
      // Skip malformed keep-alive/comments without killing the stream.
    }
  }
  return null;
}

/**
 * Run the planner loop: think → validate the choice → execute through WebMCP →
 * feed the result back → repeat until "done" (or the step cap).
 */
export async function runAgentWorkflow(opts: AgentRunOptions): Promise<AgentOutcome> {
  const abort = new AbortController();
  runningAbort = abort;
  const executed: string[] = [];
  const skipped: string[] = [];
  const thoughts: string[] = [];
  const transcript: AgentMessage[] = [];
  const toolNames = new Set(opts.tools.map((tool) => tool.name));
  const byName = new Map(opts.tools.map((tool) => [tool.name, tool]));

  try {
    for (let step = 1; step <= MAX_STEPS; step += 1) {
      const thoughtId = opts.feed.beginThought();
      let buffer = "";
      let decision: AgentDecision | null = null;
      let failure: string | null = null;

      try {
        for await (const event of streamAgentEvents(
          {
            goal: opts.context.goal,
            context: opts.context.context,
            tools: opts.tools,
            messages: transcript,
          },
          abort.signal,
        )) {
          if (event.type === "thought") {
            buffer += event.text;
            opts.feed.updateThought(thoughtId, buffer);
          } else if (event.type === "decision") {
            decision = event.decision;
          } else if (event.type === "error") {
            failure = event.message;
          }
        }
      } catch (error) {
        opts.feed.resolveThought(thoughtId, "error");
        throw error;
      }

      if (failure) {
        opts.feed.resolveThought(thoughtId, "error");
        throw new AgentFailure(failure);
      }
      if (!decision) {
        opts.feed.resolveThought(thoughtId, "error");
        throw new AgentFailure("The planner stream ended without a decision.");
      }

      thoughts.push(buffer.trim());
      opts.feed.resolveThought(thoughtId, decision.done ? "ok" : "ok");

      if (decision.done) {
        return { executed, skipped, steps: step, thoughts, summary: decision.summary ?? null };
      }

      const tool = decision.tool ?? "";
      const args = (decision.arguments ?? {}) as Record<string, unknown>;

      // Decisions must always map to a validated, registered tool.
      if (!toolNames.has(tool)) {
        skipped.push(tool);
        transcript.push({
          role: "tool",
          tool_call_id: tool,
          content: JSON.stringify({ ok: false, error: `Unknown tool "${tool}"` }),
        });
        continue;
      }
      const invalid = validateToolArguments(byName.get(tool)!, args);
      if (invalid) {
        skipped.push(tool);
        transcript.push({
          role: "tool",
          tool_call_id: tool,
          content: JSON.stringify({ ok: false, error: invalid }),
        });
        continue;
      }

      executed.push(tool);
      try {
        const output = await opts.execute(tool, args);
        transcript.push({ role: "tool", tool_call_id: tool, content: String(output ?? "null") });
      } catch (error) {
        // Surface the failure back to the planner so it can adapt its next move.
        transcript.push({
          role: "tool",
          tool_call_id: tool,
          content: JSON.stringify({ ok: false, error: errorMessage(error) }),
        });
      }
    }

    throw new AgentFailure(`The agent did not finish within ${MAX_STEPS} steps.`);
  } finally {
    runningAbort = null;
  }
}

function validateToolArguments(tool: AgentToolInfo, args: Record<string, unknown>): string | null {
  const schema = tool.parameters as Record<string, unknown> | null | undefined;
  if (!schema || typeof schema !== "object") {
    return "Tool has no declared argument schema.";
  }
  if (args === null || typeof args !== "object") {
    return "Tool arguments must be a JSON object.";
  }
  try {
    validateInput(schema, args);
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
