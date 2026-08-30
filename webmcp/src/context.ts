/**
 * Safe access to the browser's WebMCP surface.
 *
 * The API has shipped under different names across experimental Chrome
 * builds (`navigator.modelContext`, then `document.modelContext`), so we
 * resolve whichever is present and feature-detect before use. On browsers
 * without WebMCP, `getModelContext` returns `null` and the human UI is
 * untouched.
 */

import type { ModelContext, RegisterToolOptions, WebMCPTool } from "./types.js";

export type ModelContextLike = Pick<ModelContext, "registerTool">;

/**
 * Resolve the WebMCP surface, or `null` when the browser does not expose one
 * (including outside a browser at build time).
 */
export function getModelContext(): ModelContext | null {
  if (typeof window === "undefined") return null;
  const docCtx = (document as Document & { modelContext?: ModelContextLike }).modelContext;
  const navCtx = (navigator as Navigator & { modelContext?: ModelContextLike }).modelContext;
  const ctx = docCtx ?? navCtx;
  return ctx && typeof ctx.registerTool === "function" ? (ctx as ModelContext) : null;
}

/**
 * Register a WebMCP tool when the browser supports it. Resolves `false` when
 * the browser has no WebMCP surface; `true` once the browser accepted the
 * registration. Rejects if the browser refuses registration (e.g. duplicate
 * name, invalid schema, origin not origin-keyed).
 */
export async function registerTool(
  tool: WebMCPTool,
  options?: RegisterToolOptions,
): Promise<boolean> {
  const ctx = getModelContext();
  if (!ctx) return false;
  await ctx.registerTool(tool, options);
  return true;
}
