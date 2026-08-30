/**
 * WebMCP tool contract types.
 *
 * WebMCP (Web Model Context Protocol) is a proposed browser standard that
 * lets a page expose structured tools to in-browser AI agents via
 * `document.modelContext`. Tool descriptors intentionally mirror MCP's
 * `Tool` shape (name, description, inputSchema) so agent tooling can reuse a
 * common vocabulary.
 *
 * @see https://developer.chrome.com/docs/ai/webmcp
 */

/** A JSON Schema object describing a tool's input arguments. */
export type JsonSchema = Record<string, unknown>;

/** Structured text content returned by a tool execution, MCP-style. */
export interface ToolContentBlock {
  type: "text";
  text: string;
}

/** Result payload returned to the agent after a tool call. */
export interface ToolResult {
  content: ToolContentBlock[];
}

/** Options used when registering a tool. */
export interface RegisterToolOptions {
  /** Same-origin support only unless origins are explicitly listed. */
  exposedTo?: string[];
  /** Aborting the signal unregisters the tool (SPA route changes). */
  signal?: AbortSignal;
}

/** A single WebMCP tool descriptor plus its browser-side handler. */
export interface WebMCPTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /**
   * Handler invoked by the agent through the browser. Should call the same
   * application logic the human UI calls, and update the UI before returning.
   */
  execute: (
    args: Record<string, unknown>,
    context: AgentContext,
  ) => ToolResult | Promise<ToolResult>;
}

/** Per-execution runtime handle passed to `execute`. */
export interface AgentContext {
  /**
   * Ask the user for confirmation/input mid-tool. Use for any action that is
   * not read-only.
   */
  requestUserInteraction?: (message: string) => Promise<unknown>;
}

/** A tool as exposed by the browser after registration. */
export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  origin: string;
}

/** Feature detection / version-proof handle to the browser's WebMCP API. */
export interface ModelContext {
  registerTool(tool: WebMCPTool, options?: RegisterToolOptions): void | Promise<void>;
  getTools(options?: { fromOrigins?: string[] }): Promise<RegisteredTool[]>;
  executeTool(tool: RegisteredTool, args: Record<string, unknown>): Promise<ToolResult>;
}
