# `@evidenceos/webmcp`

TypeScript contract for EvidenceOS's **WebMCP** layer.

WebMCP (Web Model Context Protocol) is a proposed browser standard that lets a
page register structured, callable tools with an in-browser AI agent — instead
of the agent scraping the DOM or guessing at the UI. Tool descriptors reuse the
MCP shape (`name`, `description`, `inputSchema`), so agent tooling understands
them immediately.

## What lives here

- `src/types.ts` — `WebMCPTool`, `ToolResult`, `ModelContext` contract types.
- `src/context.ts` — safe, version-proof access to the browser's WebMCP
  surface (`document.modelContext` / `navigator.modelContext`), with graceful
  no-op fallback.
- `schemas/` — JSON Schema contracts for EvidenceOS's tools
  (`search_literature`, `create_review`, …).

## Usage

```ts
import { registerTool } from "@evidenceos/webmcp";

registerTool({
  name: "search_literature",
  description: "Search biomedical literature (PubMed). Use when finding studies.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  async execute({ query }) {
    const results = await api.search({ query }); // same logic as the UI
    return { content: [{ type: "text", text: JSON.stringify(results) }] };
  },
});
```

## Notes

- Tools are **ephemeral**: they exist only while the page is open.
- The `description` is effectively the prompt — write it for the agent.
- Mutation-heavy tools must keep a human in the loop (`requestUserInteraction`,
  no `toolautosubmit`). Only read-only operations use `toolautosubmit`.
- See `docs/webmcp.md` for the full strategy.

## Commands

```sh
npm run typecheck   # strict TS check
npm run build       # emit dist/
```
