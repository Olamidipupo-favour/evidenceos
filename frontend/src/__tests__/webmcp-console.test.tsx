import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebmcpConsole } from "@/components/webmcp-console";
import { ensureRegistered, getRuntimeState, resetRegistry } from "@/lib/webmcp/registry";
import { tools, type RegisteredTool, type WebMCPTool } from "@evidenceos/webmcp";

class FakeModelContext extends EventTarget {
  readonly tools = new Map<string, WebMCPTool>();

  async registerTool(tool: WebMCPTool): Promise<undefined> {
    this.tools.set(tool.name, tool);
    return undefined;
  }

  async getTools(): Promise<RegisteredTool[]> {
    return [...this.tools.values()].map((tool) => ({
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
    const parsed = typeof input === "string" ? JSON.parse(input) : input;
    const result = await registered?.execute(parsed ?? {}, {
      signal: new AbortController().signal,
    });
    return typeof result === "string" ? result : JSON.stringify(result);
  }

  ontoolchange: ((event: Event) => void) | null = null;
}

function installFakeContext(): FakeModelContext {
  const fake = new FakeModelContext();
  Object.defineProperty(window.document, "modelContext", {
    value: fake,
    configurable: true,
  });
  return fake;
}

function uninstallFakeContext(): void {
  Reflect.deleteProperty(window.document, "modelContext");
}

function renderConsole() {
  return render(<WebmcpConsole open onClose={vi.fn()} />);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sse(events: Array<Record<string, unknown>>): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

// A tiny two-step scripted run: think (search) → done.
type ScriptedStep = {
  thoughts: string[];
  decision: {
    done: boolean;
    tool?: string;
    summary?: string;
    arguments?: object;
  };
};

const SCRIPT: ScriptedStep[] = [
  {
    thoughts: ["Let me search PubMed for candidate studies to screen."],
    decision: {
      done: false,
      tool: "search_literature",
      arguments: { query: "metformin type 2 diabetes", page_size: 6 },
    },
  },
  {
    thoughts: ["The search returned a paper — the goal is met."],
    decision: { done: true, summary: "Completed a scripted run." },
  },
];

function thinkResponse(step: ScriptedStep): Response {
  return sse([
    ...step.thoughts.map((text) => ({ type: "thought", text })),
    { type: "decision", decision: step.decision },
  ]);
}

// A planner that fills the whole 18-step budget with read-only matrix checks
// before declaring done on the 19th step — exercising the step-limit prompt.
const LIMIT_SCRIPT: ScriptedStep[] = Array.from({ length: 19 }, (_, index) =>
  index === 18
    ? {
        thoughts: ["Enough — the goal is met."],
        decision: { done: true, summary: "Finished after the step limit." },
      }
    : {
        thoughts: [`Checking the evidence matrix (${index + 1}).`],
        decision: {
          done: false,
          tool: "get_evidence_matrix",
          arguments: { review_id: "3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c" },
        },
      },
);

beforeEach(() => resetRegistry());
afterEach(() => {
  uninstallFakeContext();
  vi.unstubAllGlobals();
});

describe("WebmcpConsole", () => {
  it("explains graceful degradation when WebMCP is missing", async () => {
    await ensureRegistered();
    expect(getRuntimeState()?.supported).toBe(false);

    renderConsole();

    expect(screen.getByText("WebMCP unavailable")).toBeInTheDocument();
    expect(screen.getByText("Re-check")).toBeInTheDocument();
    expect(screen.getByText(/no WebMCP/)).toBeInTheDocument();
    expect(screen.getByText(/the human UI remains fully functional/i)).toBeInTheDocument();
  });

  it("lists all registered tools once WebMCP is active", async () => {
    installFakeContext();
    const state = await ensureRegistered();
    expect(state.supported).toBe(true);

    renderConsole();

    await waitFor(() => {
      expect(screen.getByText(/WebMCP active/, { selector: "p" })).toBeInTheDocument();
    });

    const toolsToggle = screen.getByRole("button", { name: /registered tools/i });
    fireEvent.click(toolsToggle);

    const list = screen.getAllByRole("list")[0];
    for (const name of tools.map((t) => t.name)) {
      expect(within(list).getByText(name)).toBeInTheDocument();
    }
    expect(screen.getAllByText("read-only").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /run the full webmcp end-to-end workflow/i }),
    ).not.toBeDisabled();
  });

  it("collapses the registered-tools catalogue by default so the feed stays in view", async () => {
    installFakeContext();
    await ensureRegistered();

    renderConsole();

    const toggle = screen.getByRole("button", { name: /registered tools/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The tool catalogue is hidden until opened…
    expect(screen.queryByText(/Search the biomedical literature/i)).not.toBeInTheDocument();
    // …while the empty feed hint is already on screen.
    expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Search the biomedical literature/i)).toBeInTheDocument();
  });

  it("surfaces executions from an agent-connected model context in the feed", async () => {
    const fake = installFakeContext();
    await ensureRegistered();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            query: "q",
            page: 1,
            page_size: 6,
            total: 1,
            items: [
              {
                pmid: 174596,
                title: "Metformin for type 2 diabetes",
                abstract: "a",
                authors: ["UKPDS Group"],
                journal: "The Lancet",
                publication_date: "1998-09-12",
                doi: "10.1016/S0140-6736(98)07019-9",
                url: "https://pubmed.ncbi.nlm.nih.gov/9742976/",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const searchTool = (await fake.getTools()).find((t) => t.name === "search_literature");
    expect(searchTool).toBeDefined();

    await fake.executeTool(searchTool!, JSON.stringify({ query: "metformin" }));

    renderConsole();

    expect(screen.getAllByText("search_literature").length).toBeGreaterThan(0);
    expect(screen.getByText("View output")).toBeInTheDocument();
    expect(screen.getByText(/metformin/i)).toBeInTheDocument();
  });

  it("shows a warning banner when the demo workflow fails offline", async () => {
    installFakeContext();
    await ensureRegistered();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    renderConsole();

    const runButton = screen.getByRole("button", {
      name: /run the full webmcp end-to-end workflow/i,
    });
    expect(runButton).not.toBeDisabled();

    fireEvent.click(runButton);

    await waitFor(() => {
      expect(screen.getByText(/Workflow failed/i)).toBeInTheDocument();
    });
  });

  it("auto-collapses finished thinking rows until expanded", async () => {
    installFakeContext();
    await ensureRegistered();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    let thinkCalls = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/agent/think")) {
        const response = thinkResponse(SCRIPT[thinkCalls]!);
        thinkCalls += 1;
        return response;
      }
      if (String(input).includes("/api/search")) {
        return json({
          query: "q",
          total: 1,
          items: [
            {
              pmid: 174596,
              title: "Metformin for type 2 diabetes",
              abstract: "a",
              authors: ["UKPDS Group"],
              journal: "The Lancet",
              publication_date: "1998-09-12",
              doi: "10.1016/S0140-6736(98)07019-9",
              url: "https://pubmed.ncbi.nlm.nih.gov/9742976/",
            },
          ],
        });
      }
      return json({ detail: "unmocked" }, 404);
    });

    renderConsole();

    fireEvent.click(
      screen.getByRole("button", { name: /run the full webmcp end-to-end workflow/i }),
    );

    await waitFor(
      () => {
        expect(screen.getByText(/Workflow complete/i)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    const expanders = screen.getAllByRole("button", { name: /expand this thinking step/i });
    expect(expanders.length).toBeGreaterThan(0);
    // Collapsed by default: the detailed reasoning is not on screen.
    expect(screen.queryByText(/candidate studies to screen/i)).not.toBeInTheDocument();

    fireEvent.click(expanders[expanders.length - 1]!);
    expect(screen.getByText(/candidate studies to screen/i)).toBeInTheDocument();

    const collapsers = screen.getAllByRole("button", { name: /collapse this thinking step/i });
    fireEvent.click(collapsers[collapsers.length - 1]!);
    expect(screen.queryByText(/candidate studies to screen/i)).not.toBeInTheDocument();
  });

  it("prompts the user when the agent hits the step limit and can continue", async () => {
    installFakeContext();
    await ensureRegistered();
    let thinkCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/agent/think")) {
          thinkCalls += 1;
          return thinkResponse(LIMIT_SCRIPT[thinkCalls - 1]!);
        }
        if (String(input).includes("/api/reviews/")) {
          return json({ review: {}, total_papers: 18, included_papers: 18, papers: [] });
        }
        return json({ detail: "unmocked" }, 404);
      }),
    );

    renderConsole();
    fireEvent.click(
      screen.getByRole("button", { name: /run the full webmcp end-to-end workflow/i }),
    );

    await waitFor(
      () => {
        expect(screen.getByText(/has used 18 steps/i)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue running" }));

    await waitFor(
      () => {
        expect(screen.getByText(/Workflow complete/i)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    expect(thinkCalls).toBe(LIMIT_SCRIPT.length);
  }, 60000);

  it("stops the run when the user declines to continue past the step limit", async () => {
    installFakeContext();
    await ensureRegistered();
    let thinkCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/agent/think")) {
          thinkCalls += 1;
          return thinkResponse(LIMIT_SCRIPT[thinkCalls - 1]!);
        }
        if (String(input).includes("/api/reviews/")) {
          return json({ review: {}, total_papers: 18, included_papers: 18, papers: [] });
        }
        return json({ detail: "unmocked" }, 404);
      }),
    );

    renderConsole();
    fireEvent.click(
      screen.getByRole("button", { name: /run the full webmcp end-to-end workflow/i }),
    );

    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: "Stop agent" })).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop agent" }));

    await waitFor(
      () => {
        expect(screen.getByText(/Workflow failed/i)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    expect(thinkCalls).toBe(18);
  }, 60000);
});
