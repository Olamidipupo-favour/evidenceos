import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getModelContext,
  registerTool,
  tools,
  type ModelContext,
  type RegisteredTool,
  type WebMCPTool,
} from "@evidenceos/webmcp";

import {
  ensureRegistered,
  getRuntimeState,
  getToolCalls,
  resetRegistry,
  runDemonstration,
} from "@/lib/webmcp/registry";

const PAPER_1 = {
  pmid: 174596,
  title: "Metformin for type 2 diabetes",
  abstract: "UKPDS randomised trial.",
  authors: ["UKPDS Group"],
  journal: "The Lancet",
  publication_date: "1998-09-12",
  doi: "10.1016/S0140-6736(98)07019-9",
  url: "https://pubmed.ncbi.nlm.nih.gov/9742976/",
};

const PAPER_2 = {
  pmid: 74576,
  title: "Metformin in gestational diabetes",
  abstract: "Randomised comparison with insulin.",
  authors: ["Rowan JA"],
  journal: "NEJM",
  publication_date: "2008-05-08",
  doi: "10.1056/NEJMoa0707193",
  url: "https://pubmed.ncbi.nlm.nih.gov/18463375/",
};

const EXTRACTION = {
  id: "evt-1",
  paper_id: "pap-1",
  population: "Adults with type 2 diabetes",
  intervention: "Metformin 850 mg",
  comparison: null,
  outcome: "HbA1c",
  study_design: "RCT",
  sample_size: 1704,
  key_finding: "Reduced HbA1c",
  limitations: null,
  confidence: "medium",
  origin: "llm",
  model_name: "deepseek-v4-flash",
  created_at: "2026-08-30T10:00:00Z",
};

const REVIEW_ID = "3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c";
const MATRIX = {
  review: { id: REVIEW_ID, title: "Metformin evidence", research_question: null },
  total_papers: 1,
  included_papers: 1,
  papers: [{ ...PAPER_1, id: "pap-1", status: "included", notes: null, extractions: [EXTRACTION] }],
};

class FakeModelContext extends EventTarget {
  readonly tools = new Map<string, WebMCPTool>();

  async registerTool(tool: WebMCPTool): Promise<undefined> {
    if (this.tools.has(tool.name)) throw new Error("Tool name already registered");
    this.tools.set(tool.name, tool);
    this.dispatchEvent(new Event("toolchange"));
    return undefined;
  }

  async getTools(): Promise<RegisteredTool[]> {
    return [...this.tools.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tool) => ({
        name: tool.name,
        title: tool.title ?? "",
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        origin: window.location.origin,
        window: window,
      }));
  }

  async executeTool(tool: RegisteredTool, input?: object | string): Promise<string> {
    const registered = this.tools.get(tool.name);
    if (!registered) throw new Error(`Tool "${tool.name}" is not registered`);
    const parsed = typeof input === "string" ? JSON.parse(input) : input;
    const result = await registered.execute(parsed ?? {}, {
      signal: new AbortController().signal,
    });
    return typeof result === "string" ? result : JSON.stringify(result);
  }

  ontoolchange: ((event: Event) => void) | null = null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sse(events: Array<Record<string, unknown>>): Response {
  const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(payload, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

// A scripted planner: each /api/agent/think call streams a few thought tokens
// followed by one structured decision, mirroring the backend SSE contract.
const SCENARIO: Array<{
  thoughts: string[];
  decision: { done: boolean; tool?: string; summary?: string; arguments?: object };
}> = [
  {
    thoughts: ["I need to find primary studies.", "Searching PubMed for the question."],
    decision: {
      done: false,
      tool: "search_literature",
      arguments: { query: "metformin type 2 diabetes", page_size: 6 },
    },
  },
  {
    thoughts: ["The search returned candidate papers.", "Inspecting the top hit."],
    decision: { done: false, tool: "get_paper", arguments: { reference: 174596 } },
  },
  {
    thoughts: ["No review exists yet — creating one."],
    decision: {
      done: false,
      tool: "create_review",
      arguments: { title: "WebMCP demonstration", research_question: "metformin type 2 diabetes" },
    },
  },
  {
    thoughts: ["Review created. Adding the primary paper."],
    decision: {
      done: false,
      tool: "add_paper_to_review",
      arguments: { review_id: REVIEW_ID, pmid: 174596, status: "included" },
    },
  },
  {
    thoughts: ["Primary paper is in. Extracting its evidence."],
    decision: { done: false, tool: "extract_evidence", arguments: { reference: 174596 } },
  },
  {
    thoughts: ["Evidence extracted. Adding a second paper for comparison."],
    decision: {
      done: false,
      tool: "add_paper_to_review",
      arguments: { review_id: REVIEW_ID, pmid: 74576, status: "included" },
    },
  },
  {
    thoughts: ["Two papers gathered. Checking the evidence matrix."],
    decision: { done: false, tool: "get_evidence_matrix", arguments: { review_id: REVIEW_ID } },
  },
  {
    thoughts: ["Matrix reflects the review. Comparing the two papers."],
    decision: {
      done: false,
      tool: "compare_papers",
      arguments: { references: [174596, 74576] },
    },
  },
  {
    thoughts: ["Comparison done. Removing the redundant second paper."],
    decision: {
      done: false,
      tool: "remove_paper_from_review",
      arguments: {
        review_id: REVIEW_ID,
        paper_id: "b2c3d4e5-6f70-8a9b-0c1d-2e3f4a5b6c7d",
      },
    },
  },
  {
    thoughts: ["Goal met — every step executed and the review is clean."],
    decision: { done: true, summary: "Completed an end-to-end evidence run." },
  },
];

function thinkResponse(step: (typeof SCENARIO)[number]): Response {
  return sse([
    ...step.thoughts.map((text) => ({ type: "thought", text })),
    { type: "decision", decision: step.decision },
  ]);
}

function installFakeContext(): FakeModelContext {
  const fake = new FakeModelContext();
  Object.defineProperty(window.document, "modelContext", { value: fake, configurable: true });
  return fake;
}

function uninstallFakeContext(): void {
  Reflect.deleteProperty(window.document, "modelContext");
}

function backendResponder(url: string, method: string): Response {
  if (url.includes("/api/search"))
    return json({ query: "q", page: 1, page_size: 6, total: 2, items: [PAPER_1, PAPER_2] });
  if (url.includes("/api/papers/174596/extract")) return json(EXTRACTION, 201);
  if (url.includes("/api/papers/74576/evidence")) return json([]);
  if (url.includes("/api/papers/174596/evidence")) return json([EXTRACTION]);
  if (url.includes("/api/papers/74576")) return json(PAPER_2);
  if (url.includes("/api/papers/174596")) return json(PAPER_1);
  if (url.includes("/api/reviews/3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c/matrix")) return json(MATRIX);
  if (url.includes("/api/reviews/3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c/papers")) {
    if (method === "DELETE") return new Response(null, { status: 204 });
    return json(
      {
        review_id: REVIEW_ID,
        paper_id: "b2c3d4e5-6f70-8a9b-0c1d-2e3f4a5b6c7d",
        status: "included",
        notes: null,
        created_at: "2026-08-30T00:00:00Z",
      },
      201,
    );
  }
  if (url.includes("/api/reviews")) {
    if (method === "POST")
      return json({ id: REVIEW_ID, title: "Metformin evidence", research_question: null }, 201);
    return json([
      {
        id: REVIEW_ID,
        title: "Metformin evidence",
        research_question: null,
        created_at: "2026-08-30T00:00:00Z",
      },
    ]);
  }
  return json({ detail: "unmocked" }, 404);
}

function stubBackend(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
    backendResponder(String(input), init?.method ?? "GET"),
  );
}

describe("registry — WebMCP feature detection", () => {
  beforeEach(() => resetRegistry());

  it("reports no-api on browsers without document.modelContext", async () => {
    uninstallFakeContext();
    const state = await ensureRegistered();
    expect(state.supported).toBe(false);
    if (!state.supported) expect(state.reason).toBe("no-api");
    expect(getRuntimeState()?.supported).toBe(false);
  });

  it("registerTool no-ops (false) without the API", async () => {
    uninstallFakeContext();
    await expect(
      registerTool({
        name: "search_literature",
        description: "desc",
        inputSchema: { type: "object" },
        execute: async () => "ok",
      }),
    ).resolves.toBe(false);
    expect(getModelContext()).toBeNull();
  });
});

describe("registry — registration watchdog", () => {
  afterEach(() => {
    uninstallFakeContext();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("settles to registration-failed instead of hanging on a stalled browser", async () => {
    vi.useFakeTimers();
    resetRegistry();
    uninstallFakeContext();

    class HungContext extends EventTarget implements ModelContext {
      readonly tools = new Map<string, WebMCPTool>();
      async registerTool(tool: WebMCPTool): Promise<undefined> {
        this.tools.set(tool.name, tool);
        return new Promise(() => {});
      }
      async getTools(): Promise<RegisteredTool[]> {
        return [];
      }
      async executeTool(): Promise<string> {
        return "[]";
      }
      ontoolchange: ((event: Event) => void) | null = null;
    }
    Object.defineProperty(window.document, "modelContext", {
      value: new HungContext(),
      configurable: true,
    });

    const pending = ensureRegistered();
    await vi.advanceTimersByTimeAsync(10_001);

    const state = await pending;
    expect(state.supported).toBe(false);
    if (!state.supported) expect(state.reason).toBe("registration-failed");
    expect(getRuntimeState()?.supported).toBe(false);
  });

  it("surfaces a reason when the modelContext getter throws instead of staying silent", async () => {
    resetRegistry();
    Object.defineProperty(window.document, "modelContext", {
      configurable: true,
      get() {
        throw new Error("blocked by permissions policy");
      },
    });

    const state = await ensureRegistered();
    expect(state.supported).toBe(false);
    if (!state.supported) {
      expect(state.reason).toBe("registration-failed");
      expect(state.detail).toContain("WebMCP");
    }
    expect(getRuntimeState()?.supported).toBe(false);
  });

  it("still registers when the shim lacks event hooks", async () => {
    resetRegistry();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stubBackend(fetchMock);

    const shim = new FakeModelContext();
    Object.defineProperty(shim, "addEventListener", {
      configurable: true,
      value() {
        throw new Error("shim exposes no event hooks");
      },
    });
    Object.defineProperty(window.document, "modelContext", {
      value: shim,
      configurable: true,
    });

    const state = await ensureRegistered();
    expect(state.supported).toBe(true);
  });
});

describe("registry — registration with a WebMCP context", () => {
  beforeEach(() => {
    resetRegistry();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stubBackend(fetchMock);
  });
  afterEach(() => {
    uninstallFakeContext();
    vi.unstubAllGlobals();
  });

  it("registers all eight EvidenceOS tools with the browser", async () => {
    const fake = installFakeContext();
    const state = await ensureRegistered();

    expect(state.supported).toBe(true);
    if (state.supported) {
      expect(state.registered).toHaveLength(8);
      expect(state.registered.filter((e) => e.registered)).toHaveLength(8);
      expect(state.registered.map((e) => e.name)).toEqual(
        expect.arrayContaining([
          "search_literature",
          "get_paper",
          "create_review",
          "add_paper_to_review",
          "remove_paper_from_review",
          "extract_evidence",
          "get_evidence_matrix",
          "compare_papers",
        ]),
      );
    }

    const discovered = await fake.getTools();
    expect(discovered.map((t) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
    const search = discovered.find((t) => t.name === "search_literature");
    expect(search?.annotations?.readOnlyHint).toBe(true);
    const create = discovered.find((t) => t.name === "create_review");
    expect(create?.annotations?.readOnlyHint).toBe(false);
  });

  it("logs real executions into the feed and rejects malformed inputs", async () => {
    const fake = installFakeContext();
    await ensureRegistered();

    const searchTool = (await fake.getTools()).find((t) => t.name === "search_literature");
    expect(searchTool).toBeDefined();

    const result = await fake.executeTool(searchTool!, JSON.stringify({ query: "metformin" }));
    expect(result).toMatch(/metformin/i);

    await expect(fake.executeTool(searchTool!, JSON.stringify({ nope: true }))).rejects.toThrow();

    const calls = getToolCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0]?.tool).toBe("search_literature");
    expect(calls[0]?.status).toBe("error");
    expect(calls[0]?.error).toContain("Malformed input");
    expect(calls[1]?.status).toBe("ok");
    expect(calls[1]?.result).toMatch(/metformin/i);
  });

  it("tolerates a single-argument execute from the WebMCP runtime", async () => {
    const fake = installFakeContext();
    await ensureRegistered();

    const search = (await fake.getTools()).find((t) => t.name === "search_literature");
    expect(search).toBeDefined();
    const raw = fake.tools.get("search_literature");
    expect(raw).toBeDefined();

    // The browser runtime may invoke execute(input) with no context argument;
    // the executor must not destructure a missing context (regression guard).
    const execute = raw!.execute as unknown as (input: object) => Promise<string> | string;
    const result = await execute({ query: "metformin" });
    expect(String(result)).toMatch(/metformin/i);
  });
});

describe("registry — demonstration workflow", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetRegistry();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stubBackend(fetchMock);
  });
  afterEach(() => {
    uninstallFakeContext();
    vi.unstubAllGlobals();
  });

  it("streams agent thoughts and executes each scripted decision through WebMCP", async () => {
    installFakeContext();
    const state = await ensureRegistered();
    expect(state.supported).toBe(true);

    // Serve the scripted planner stream for /api/agent/think and pass every
    // other call to the normal backend stubs.
    let thinkCalls = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/agent/think")) {
        const step = SCENARIO[thinkCalls];
        thinkCalls += 1;
        expect(step).toBeDefined();
        return thinkResponse(step!);
      }
      return backendResponder(url, init?.method ?? "GET");
    });

    const summary = await runDemonstration();

    expect(summary.ok).toBe(true);
    // The planner picks each tool itself: search → get paper → create review →
    // add primary → extract → add secondary → matrix → compare → remove.
    expect(summary.executed).toEqual([
      "search_literature",
      "get_paper",
      "create_review",
      "add_paper_to_review",
      "extract_evidence",
      "add_paper_to_review",
      "get_evidence_matrix",
      "compare_papers",
      "remove_paper_from_review",
    ]);
    expect(summary.skipped).toEqual([]);
    expect(thinkCalls).toBe(SCENARIO.length);
    expect(summary.steps).toBe(SCENARIO.length);
    expect(summary.thoughts).toBe(SCENARIO.length);
    expect(summary.summary).toBe("Completed an end-to-end evidence run.");

    const calls = getToolCalls();
    const workflow = calls.find((c) => c.tool === "workflow");
    expect(workflow?.status).toBe("ok");
    expect(workflow?.input).toEqual({ name: "Agent orchestrator run" });
    expect(workflow?.result).toContain('"steps": 10');
    expect(workflow?.result).toContain("Completed an end-to-end evidence run.");

    // Every executed tool row gets the workflow badge.
    const executedSteps = calls.filter((c) => c.kind === "tool" && c.tool !== "workflow");
    expect(executedSteps.map((c) => c.tool)).toEqual([...summary.executed].reverse());
    expect(executedSteps.every((c) => c.source === "demo" && c.status === "ok")).toBe(true);

    // One streamed thought bubble per planner step, resolved when the step
    // completes and carrying the consolidated reasoning text.
    const thoughtRows = calls.filter((c) => c.kind === "thought");
    expect(thoughtRows).toHaveLength(SCENARIO.length);
    expect(thoughtRows.every((c) => c.tool === "thought" && c.source === "demo")).toBe(true);
    expect(thoughtRows.every((c) => c.status === "ok")).toBe(true);
    expect(thoughtRows.some((c) => c.result?.includes("Searching PubMed"))).toBe(true);
    expect(thoughtRows.some((c) => c.result?.includes("Goal met — every step executed"))).toBe(
      true,
    );
  });

  it("reports a planner-stream failure as a failed run", async () => {
    installFakeContext();
    await ensureRegistered();

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/agent/think")) {
        return sse([{ type: "error", message: "Provider unavailable" }]);
      }
      return backendResponder(String(input), "GET");
    });

    const summary = await runDemonstration();
    expect(summary.ok).toBe(false);
    expect(summary.error).toBe("Provider unavailable");

    const calls = getToolCalls();
    const workflow = calls.find((c) => c.tool === "workflow");
    expect(workflow?.status).toBe("error");
    expect(workflow?.error).toBe("Provider unavailable");
    // The planner retries twice before giving up — each attempt produces a
    // thought row marked as an error.
    const thoughtRows = calls.filter((c) => c.kind === "thought");
    expect(thoughtRows.length).toBeGreaterThanOrEqual(1);
    expect(thoughtRows.every((c) => c.status === "error")).toBe(true);
  });

  it("blocks the planner from re-executing an identical mutation", async () => {
    installFakeContext();
    await ensureRegistered();

    const script = [
      {
        thoughts: ["Adding the primary paper."],
        decision: {
          done: false,
          tool: "add_paper_to_review",
          arguments: { review_id: REVIEW_ID, pmid: 174596, status: "included" },
        },
      },
      {
        thoughts: ["Hmm — add it again just in case."],
        decision: {
          done: false,
          tool: "add_paper_to_review",
          arguments: { review_id: REVIEW_ID, pmid: 174596, status: "included" },
        },
      },
      {
        thoughts: ["The paper is already captured — done."],
        decision: { done: true, summary: "Stopped repeating an identical mutation." },
      },
    ];

    let thinkCalls = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/agent/think")) {
        const step = script[thinkCalls];
        thinkCalls += 1;
        return thinkResponse(step!);
      }
      return backendResponder(url, init?.method ?? "GET");
    });

    const summary = await runDemonstration();

    expect(summary.ok).toBe(true);
    // The second, identical mutation was refused; only the first ran.
    expect(summary.executed).toEqual(["add_paper_to_review"]);
    expect(summary.steps).toBe(script.length);
    expect(thinkCalls).toBe(script.length);

    const calls = getToolCalls();
    const adds = calls.filter((c) => c.kind === "tool" && c.tool === "add_paper_to_review");
    expect(adds).toHaveLength(1);
    expect(adds[0]?.status).toBe("ok");
  });
});

describe("tool catalogue metadata", () => {
  it("declares valid, unique, spec-conformant tool names", () => {
    const names = tools.map((t) => t.name);
    expect(names).toHaveLength(8);
    expect(new Set(names).size).toBe(8);
    for (const name of names) {
      expect(name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
    }
  });

  it("marks mutating tools as non-read-only", () => {
    const mutating = [
      "create_review",
      "add_paper_to_review",
      "remove_paper_from_review",
      "extract_evidence",
    ];
    for (const name of mutating) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.annotations?.readOnlyHint).toBe(false);
    }
    for (const name of [
      "search_literature",
      "get_paper",
      "get_evidence_matrix",
      "compare_papers",
    ]) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });
});
