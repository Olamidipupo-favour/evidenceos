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

    const list = screen.getAllByRole("list")[0];
    for (const name of tools.map((t) => t.name)) {
      expect(within(list).getByText(name)).toBeInTheDocument();
    }
    expect(screen.getAllByText("read-only").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /run the full webmcp demonstration workflow/i }),
    ).not.toBeDisabled();
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
      name: /run the full webmcp demonstration workflow/i,
    });
    expect(runButton).not.toBeDisabled();

    fireEvent.click(runButton);

    await waitFor(() => {
      expect(screen.getByText(/Workflow failed/i)).toBeInTheDocument();
    });
  });
});
