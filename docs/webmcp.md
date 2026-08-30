# EvidenceOS → WebMCP strategy

## What WebMCP is

WebMCP (Web Model Context Protocol) is a **proposed web standard** that lets a
website hand a browser-hosted AI agent a set of **structured tools** instead of
leaving the agent to scrape the DOM. It exposes two APIs on a page:

- **Imperative** — `document.modelContext.registerTool({ name, description,
  inputSchema, execute })`; the agent discovers tools via `getTools()` and calls
  them via `executeTool()`.
- **Declarative** — annotate an HTML `<form>` with `toolname`,
  `tooldescription`, `toolparamdescription`, `toolautosubmit` and the browser
  synthesizes a tool from the existing fields (`name`, `required`, `type`
  become the JSON Schema).

Tool descriptors intentionally share MCP's `Tool` vocabulary, but WebMCP is the
*browser-side* sibling: tools are ephemeral (page-tab scoped), run in the user's
session, and keep the human in the loop.

## Why it fits EvidenceOS

For a medical research workspace the demonstrable WebMCP value is exactly the
work agents are bad at and tools make reliable:

- `search_literature` — a structured PubMed query beats an agent re-clicking a
  search box and mis-parsing result rows.
- `get_paper` — fetch fully-structured metadata instead of screenshotting rows.
- `create_review` / `add_paper_to_review` — structured arguments that cannot be
  hallucinated into the wrong field.
- `build_evidence_matrix` — deterministic, schema-driven matrix assembly.

This is "agent + human on the same artifact", not a chatbot bolted on.

## EvidenceOS tool contract

- Definitions & schemas: `webmcp/schemas/*.json`.
- Registration helper + types: `webmcp/src/`.
- Every `execute` calls the same fetch/handler the UI uses
  (`frontend/`), staying API-driven and never duplicating logic.
- The `description` field is treated as a prompt: "Use when …" phrasing tells
  the agent *when* to invoke the tool.

## Safety rules (non-negotiable)

1. `toolautosubmit` only on **read-only** tools (search, export). Anything that
   mutates (create/attach) keeps an explicit human confirmation — via
   `requestUserInteraction` or "human confirms to route" UI.
2. Guard every registration with feature detection
   (`document.modelContext || navigator.modelContext`); on browsers without
   WebMCP the page behaves exactly as today.
3. Validate agent-supplied arguments server-side on the backend API as well —
   WebMCP is a UX/contract layer, not a security boundary.
4. Do not register cross-origin tools without an explicit
   `exposedTo: ["https://…"]` allowlist.
5. Mutate the DOM *before* returning from `execute` so a verifying agent sees
   the applied state, then return an MCP-style
   `{ content: [{ type: "text", text }] }` result.

## Testing

- Google's "Model Context Tool Inspector" extension can list a page's registered
  tools, call them manually, and validate JSON Schema — use it to verify tool
  discovery and arguments during development.
- Alternative/baseline: the same endpoints under a normal MCP server (for the
  WebMCP vs server-MCP comparison, per the Chrome guidance that the two are
  complementary).

## References

- Chrome for Developers: https://developer.chrome.com/docs/ai/webmcp
- API proposal (W3C Web Machine Learning WG):
  https://webmachinelearning.github.io/webmcp/docs/proposal.html
- WebMCP Challenge: https://openai.com/webmcp-challenge/