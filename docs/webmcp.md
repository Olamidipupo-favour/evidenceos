# EvidenceOS → WebMCP strategy

## What WebMCP is

WebMCP (Web Model Context Protocol) is a **proposed web standard** that lets a
website hand a browser-hosted AI agent a set of **structured tools** instead of
leaving the agent to scrape the DOM. It exposes an API surface on a page:

- `document.modelContext` (falling back to `navigator.modelContext`) — a
  `ModelContext` object with:
  - `registerTool(tool, { signal?, exposedTo? })` — register one tool;
    duplicate names are rejected with an error.
  - `getTools({ fromOrigins? })` — discover registered tools (sorted by name).
  - `executeTool(tool, input, { signal? })` — invoke a tool; input is a JSON
    object (agents ported from the Chrome MCP docs may pass a JSON string).
  - a `toolchange` event fired when the registry changes.

Tools are ephemeral (page-tab scoped), run in the user's session, and return a
JSON-serializable value which the browser hands to the agent as a string.

**Gating.** WebMCP is only exposed in secure, origin-keyed contexts:
`https://` with `Cross-Origin-Opener-Policy: same-origin`, or `file://`, in
Chromium 146+ with the origin trial or `#enable-webmcp-testing`. Outside that
the page degrades gracefully.

## Why it fits EvidenceOS

For a medical research workspace the demonstrable WebMCP value is exactly the
work agents are bad at and tools make reliable:

- `search_literature` — a structured PubMed query beats an agent re-clicking a
  search box and mis-parsing result rows.
- `get_paper` / `compare_papers` — fully-structured metadata and a deterministic
  side-by-side evidence comparison instead of screenshotting rows.
- `create_review` / `add_paper_to_review` / `remove_paper_from_review` —
  structured arguments that cannot be hallucinated into the wrong field.
- `extract_evidence` — structured LLM extraction reusing the backend pipeline.
- `get_evidence_matrix` — schema-driven matrix assembly.

This is "agent + human on the same artifact", not a chatbot bolted on.

## EvidenceOS tool contract

- Definitions & schemas: `webmcp/schemas/*.schema.json` + `webmcp/src/tools.ts`.
- Registration + visibility layer: `frontend/src/lib/webmcp/registry.ts`
  (feature detection, single-flight registration, a cap-60 call feed mirrored
  into the **Agent Actions** panel, and an agent orchestrator run that drives the
  real `getTools()` / `executeTool()`).
- Executors: `frontend/src/lib/webmcp/executors.ts` — every tool calls the same
  backend API the human UI uses (`frontend/src/lib/api.ts`), staying API-driven
  and never duplicating logic.
- Validator: `frontend/src/lib/webmcp/validate.ts` — a draft 2020-12 subset
  (types, unions, enums, const, required, `additionalProperties`, string
  patterns/lengths, numeric bounds, arrays, `oneOf`/`anyOf`) applied before any
  execution.
- The `description` field is treated as a prompt: "Use when …" phrasing tells
  the agent _when_ to invoke the tool.

## Safety rules (non-negotiable)

1. **No fake tools.** Any registered tool must perform its real, observable
   action through the backend — no mocks, no stubs, no hardcoded results.
2. **Graceful degradation.** Guard every registration with feature detection;
   on browsers without WebMCP the page behaves exactly as today (the panel
   shows a clear "WebMCP unavailable" state with enablement guidance).
3. **Validate agent inputs.** `inputSchema` + the frontend validator reject
   malformed or unknown arguments before execution; the backend API validates
   authoritatively as well — WebMCP is a UX/contract layer, not a security
   boundary.
4. **Mutation hints.** Annotate read-only tools with
   `readOnlyHint: true`; mutating tools (create/attach/remove/extract) set
   `readOnlyHint: false` and mark untrusted content with
   `untrustedContentHint: true`. Humans stay in the loop through the existing
   UI (reviews, screening, extraction) that any mutation feeds into.
5. **Machine-readable results.** `execute` returns the tool's structured value
   (serialized to a string by the browser), so an agent sees the applied state
   in the same shape the UI works with.
6. **No cross-origin exposure.** Do not register tools for other origins
   without an explicit `exposedTo: ["https://…"]` allowlist.

## Testing

- `frontend/src/__tests__/webmcp-*` — vitest suites: schema-strictness tests for
  every tool, executor tests against a mocked backend (determinism included),
  registry tests against a fake `document.modelContext` (a `ModelContext`
  `EventTarget`), and console component tests for both the supported and
  degraded states.
- Live: the **Agent Actions** panel ("agent actions" button in the header) shows
  registration status, the registered tools, and every execution. The _Run
  agent_ button starts the LLM-driven orchestrator (`agent.ts` +
  `backend: POST /api/agent/think`, SSE): the planner reasons aloud — thoughts
  stream into the feed token by token — and chooses each tool call itself,
  following the active review's research question so the matrix fills up live.
  The orchestrator only validates and executes the choice; failures and illegal
  tool picks are fed back to the planner so it adapts, capped at 12 steps. It
  only creates a review (and activates it) when no review exists yet, so
  workspaces are never polluted with a throwaway demo review. Requires
  WebMCP-capable Chromium (`#enable-webmcp-testing` or the origin trial).

## References

- API specification (W3C draft): https://webmachinelearning.github.io/webmcp/
- Chrome for Developers: https://developer.chrome.com/docs/ai/webmcp
