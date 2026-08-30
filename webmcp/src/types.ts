/**
 * WebMCP tool contract types, mirroring the current W3C WebMCP proposal and
 * Chrome's imperative API.
 *
 * WebMCP lets a page expose structured tools to browser-hosted AI agents via
 * `document.modelContext`. Tool descriptors reuse MCP's shape (name,
 * description, inputSchema) but tools are ephemeral, page-scoped, and execute
 * in the user's session.
 *
 * @see https://developer.chrome.com/docs/ai/webmcp/imperative-api
 * @see https://webmachinelearning.github.io/webmcp/
 */

/** A JSON Schema object describing a tool's input arguments (draft 2020-12). */
export type JsonSchema = Record<string, unknown>;

/** Tool metadata agents use to decide whether they may invoke a tool. */
export interface ToolAnnotations {
  /** True when execution has no side effects (search/enumeration/export). */
  readOnlyHint?: boolean;
  /** True when execution returns content from an untrusted source (web/LLM). */
  untrustedContentHint?: boolean;
}

/** Runtime handle passed to every tool execution. */
export interface ToolExecuteContext {
  /** Abort this signal to cancel a pending execution (user or agent). */
  signal: AbortSignal;
}

/**
 * A tool's handler. Return any JSON-serializable value (or a string); the
 * browser serializes it before handing it back to the caller of
 * `executeTool`.
 */
export type ToolExecute = (
  input: Readonly<Record<string, unknown>>,
  context: ToolExecuteContext,
) => unknown | Promise<unknown>;

/** A single WebMCP tool descriptor plus its browser-side handler. */
export interface WebMCPTool {
  /** 1–128 chars, ASCII alphanumeric plus `_ . -`. */
  name: string;
  /** Optional human- and agent-facing display title. */
  title?: string;
  /** Written for the agent: what it does and when to use it. */
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
  execute: ToolExecute;
}

/** Options for `ModelContext.registerTool`. */
export interface RegisterToolOptions {
  /** Explicit allowlist of cross-origin documents allowed to use the tool. */
  exposedTo?: string[];
  /** Aborting the signal unregisters the tool (SPA route changes). */
  signal?: AbortSignal;
}

/** How a tool looks to the caller of `ModelContext.getTools`. */
export interface RegisteredTool {
  name: string;
  title: string;
  description: string;
  inputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
  origin: string;
  window?: unknown;
}

/** Options for `ModelContext.executeTool`. */
export interface ExecuteToolOptions {
  signal?: AbortSignal;
}

/** A browser's WebMCP surface, per the current proposal. */
export interface ModelContext extends EventTarget {
  registerTool(tool: WebMCPTool, options?: RegisterToolOptions): Promise<undefined>;
  getTools(options?: { fromOrigins?: string[] }): Promise<RegisteredTool[]>;
  executeTool(
    tool: RegisteredTool,
    input?: object | string,
    options?: ExecuteToolOptions,
  ): Promise<string | null>;
  ontoolchange: ((event: Event) => void) | null;
}

/** Valid characters for a WebMCP tool name ([A-Za-z0-9_.-], 1–128 chars). */
export const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

/** Returns true when `name` is conformant with the WebMCP spec. */
export function isValidToolName(name: string): boolean {
  return TOOL_NAME_PATTERN.test(name);
}
