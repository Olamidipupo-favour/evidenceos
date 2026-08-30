/**
 * Safe access to the browser's WebMCP surface.
 *
 * The API has shipped under different names across experimental Chrome
 * builds (`navigator.modelContext`, then `document.modelContext`), so we
 * resolve whichever is present and feature-detect before use. Agents register
 * no tools and the human UI is untouched on browsers without WebMCP.
 */

import type { ModelContext, WebMCPTool } from "./types.js";

export type ModelContextLike = Pick<ModelContext, "registerTool">;

/**
 * Resolve the WebMCP surface, or `null` when the browser does not expose one.
 * Also returns `null` outside a browser (SSR/build-time).
 */
export function getModelContext(): ModelContext | null {
  if (typeof window === "undefined") return null;
  const docCtx = (document as Document & { modelContext?: ModelContextLike }).modelContext;
  const navCtx = (navigator as Navigator & { modelContext?: ModelContextLike }).modelContext;
  const ctx = docCtx ?? navCtx;
  return ctx && typeof ctx.registerTool === "function" ? (ctx as ModelContext) : null;
}

/**
 * Register a WebMCP tool when the browser supports it; no-op otherwise.
 * The `description` is the prompt — write it from the agent's perspective.
 */
export function registerTool(
  tool: WebMCPTool,
  options?: { signal?: AbortSignal; exposedTo?: string[] },
): boolean {
  const ctx = getModelContext();
  if (!ctx) return false;
  void ctx.registerTool(tool, options);
  return true;
}
