# `@evidenceos/webmcp`

TypeScript contract for EvidenceOS's **WebMCP** layer.

WebMCP (Web Model Context Protocol) is a proposed browser standard that lets a
page register structured, callable tools with an in-browser AI agent — instead
of the agent scraping the DOM or guessing at the UI. Tool descriptors reuse the
MCP shape (`name`, `description`, `inputSchema`), so agent tooling understands
them immediately.

## What lives here

- `src/types.ts` — `WebMCPTool`, `ToolAnnotations`, `ModelContext`,
  `RegisteredTool` contract types matching the current WebMCP spec
  (registerTool / getTools / executeTool / toolchange).
- `src/context.ts` — safe, version-proof access to the browser's WebMCP
  surface (`document.modelContext` / `navigator.modelContext`), with graceful
  no-op fallback.
- `src/tools.ts` — the **eight EvidenceOS tool contracts** + `toolName()`-style
  metadata: `search_literature`, `get_paper`, `create_review`,
  `add_paper_to_review`, `remove_paper_from_review`, `extract_evidence`,
  `get_evidence_matrix`, `compare_papers`.
- `schemas/` — JSON Schema (draft 2020-12) `inputSchema` files for each tool,
  imported into the contracts at build time.

## Usage

```ts
import { getModelContext } from "@evidenceos/webmcp";

const modelContext = getModelContext(); // null when the browser lacks WebMCP
if (!modelContext) return;

await modelContext.registerTool(
  {
    name: "search_literature",
    title: "Search biomedical literature",
    description:
      "Query PubMed via the EvidenceOS backend. Use when finding studies " +
      "for a review, e.g. searching 'metformin type 2 diabetes'.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    async execute(input, { signal }) {
      // Returns any JSON-serializable value; the browser stringifies it.
      return await api.searchLiterature(input.query, { signal });
    },
  },
  { signal },
);
```

## Notes

- Tools are **ephemeral**: they exist only while the page is open.
- The `description` is effectively the prompt — write it for the agent ("Use
  when …").
- `execute` returns a JSON-serializable value, which the browser returns to the
  agent as a string (it may also be supplied a JSON-string input; EvidenceOS
  coerces both forms in `frontend/src/lib/webmcp/registry.ts`).
- Mutation hints travel as `annotations.{readOnlyHint,untrustedContentHint}`,
  not as per-tool submission flags.
- Every tool implementation (in `frontend/src/lib/webmcp/executors.ts`) calls
  the same backend API the human UI uses — never a parallel implementation.

## Commands

```sh
npm run typecheck   # strict TS check
npm run build       # emit dist/src + dist/schemas
```
