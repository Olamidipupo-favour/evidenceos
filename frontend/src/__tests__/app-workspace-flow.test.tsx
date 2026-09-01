import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { App } from "@/components/app";

const REVIEW_1 = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Metformin evidence",
  research_question: null,
  created_at: "2026-08-30T00:00:00Z",
};

const NEW_REVIEW = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "SGLT2 and cardiovascular outcomes",
  research_question: "In adults with type 2 diabetes, do SGLT2 inhibitors reduce MACE?",
  created_at: "2026-08-31T00:00:00Z",
};

const NEW_WORKSPACE_VALUE = "__new_workspace__";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function emptyMatrix(reviewId: string, title: string) {
  return {
    review: { id: reviewId, title, research_question: null, created_at: "2026-08-30T00:00:00Z" },
    total_papers: 0,
    included_papers: 0,
    papers: [],
  };
}

describe("App — workspace switching and creation", () => {
  beforeEach(() => {
    // A single existing review; the store falls back to it when persisted
    // storage is unavailable in the test environment.
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("/health")) return Promise.resolve(json({ status: "ok" }));
        const matrix = url.match(/\/api\/reviews\/([^/]+)\/matrix$/);
        if (matrix) return Promise.resolve(json(emptyMatrix(matrix[1]!, "Switch")));
        if (url.includes("/api/reviews")) {
          if (method === "POST") return Promise.resolve(json(NEW_REVIEW, 201));
          return Promise.resolve(json([REVIEW_1]));
        }
        return Promise.resolve(json({ detail: "Not found" }, 404));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function switcher(): HTMLSelectElement {
    return screen.getByRole("combobox", { name: "Switch review" }) as HTMLSelectElement;
  }

  it("offers a New workspace option in the switch dropdown", async () => {
    render(<App />);

    const first = (await screen.findByRole("combobox", {
      name: "Switch review",
    })) as HTMLSelectElement;
    const labels = Array.from(first.options).map((o) => o.label);
    expect(labels).toContain("+ New workspace…");
    expect(labels).toContain(REVIEW_1.title);
  });

  it("routes to the create card and back when picking New workspace", async () => {
    render(<App />);

    const select = await screen.findByRole("combobox", { name: "Switch review" });
    fireEvent.change(select, { target: { value: NEW_WORKSPACE_VALUE } });

    expect(await screen.findByRole("heading", { name: "Start a review." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to current review/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Research question" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Back to current review/i }));

    expect(await screen.findByRole("heading", { name: "Research question" })).toBeInTheDocument();
    await waitFor(() => expect(switcher().value).toBe(REVIEW_1.id));
  });

  it("returns to the grid with the new review after creating a workspace", async () => {
    render(<App />);

    const select = await screen.findByRole("combobox", { name: "Switch review" });
    fireEvent.change(select, { target: { value: NEW_WORKSPACE_VALUE } });

    await screen.findByRole("heading", { name: "Start a review." });
    fireEvent.change(screen.getByLabelText("Review title"), {
      target: { value: NEW_REVIEW.title },
    });
    fireEvent.change(screen.getByLabelText(/Research question/), {
      target: { value: NEW_REVIEW.research_question ?? "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    expect(await screen.findByRole("heading", { name: "Research question" })).toBeInTheDocument();
    await waitFor(() => expect(switcher().value).toBe(NEW_REVIEW.id));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Switch review" })).toHaveTextContent(
        NEW_REVIEW.title,
      ),
    );
  });

  it("mirrors agent tool executions into the agent activity panel", async () => {
    render(<App />);

    await screen.findByRole("combobox", { name: "Switch review" });
    window.dispatchEvent(
      new CustomEvent("evidenceos:tool-activity", {
        detail: { tool: "search_literature", status: "ok", detail: null },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle activity panel" }));
    expect(await screen.findByText("Agent tool search_literature succeeded.")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText("Activity")).toBeInTheDocument();
  });

  it("switches the workspace when the agent selects a review", async () => {
    render(<App />);

    await screen.findByRole("combobox", { name: "Switch review" });
    window.dispatchEvent(
      new CustomEvent("evidenceos:select-review", { detail: { reviewId: REVIEW_1.id } }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle activity panel" }));

    expect(await screen.findByText(/Opened "Metformin evidence"/)).toBeInTheDocument();
  });
});
