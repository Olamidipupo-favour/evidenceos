import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PaperDetail } from "@/components/paper-detail";
import { SearchPane } from "@/components/search-pane";
import { WorkspaceProvider } from "@/lib/workspace";

const paper = {
  pmid: 174596,
  title: "Effect of intensive blood-glucose control with metformin on complications",
  abstract: "A randomised trial in overweight patients with type 2 diabetes.",
  authors: ["UKPDS Group"],
  journal: "The Lancet",
  publication_date: "1998-09-12",
  doi: "10.1016/S0140-6736(98)07019-9",
  url: "https://pubmed.ncbi.nlm.nih.gov/174596/",
};

const searchBody = {
  query: "metformin",
  page: 1,
  page_size: 25,
  total: 1,
  items: [paper],
};

const baseRow = {
  paper_id: "pap-1",
  intervention: "Dapagliflozin 10 mg",
  outcome: "3-point MACE",
  study_design: "Randomized controlled trial",
  key_finding: "HR 0.86 (95% CI 0.73-1.00) for MACE",
  limitations: null,
  created_at: "2026-08-30T12:00:00Z",
};

const generatedRow = {
  ...baseRow,
  id: "evt-2",
  population: null,
  comparison: null,
  sample_size: null,
  confidence: "high",
  origin: "llm",
  model_name: "deepseek-v4-flash",
};

const manualRow = {
  ...baseRow,
  id: "evt-1",
  population: "Adults with T2D",
  comparison: "Placebo",
  sample_size: 4744,
  confidence: "medium",
  origin: "manual",
  model_name: null,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function mockFetch(initialEvidence: unknown[]) {
  let rows = [...initialEvidence];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/health")) return Promise.resolve(json({ status: "ok" }));
      if (url.includes("/api/reviews")) return Promise.resolve(json([]));
      if (url.includes("/api/search")) return Promise.resolve(json(searchBody));
      if (url.includes("/extract") && init?.method === "POST") {
        rows = [generatedRow, ...rows];
        return Promise.resolve(json(generatedRow, 201));
      }
      if (url.includes("/evidence")) return Promise.resolve(json(rows));
      return Promise.resolve(json({ detail: "Not found" }, 404));
    }),
  );
}

async function openPaperDrawer() {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "metformin" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(await screen.findByRole("button", { name: /View details for paper/ }));
}

describe("PaperDetail evidence extraction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("distinguishes reported (manual) from generated (LLM) evidence", async () => {
    mockFetch([manualRow, generatedRow]);
    render(
      <WorkspaceProvider>
        <SearchPane />
        <PaperDetail />
      </WorkspaceProvider>,
    );

    await openPaperDrawer();

    expect(await screen.findByText("Reported")).toBeInTheDocument();
    expect(screen.getByText("Generated")).toBeInTheDocument();
    expect(
      screen.getByText(/LLM interpretation via deepseek-v4-flash — verify against the source/),
    ).toBeInTheDocument();
    expect(screen.getByText("Adults with T2D")).toBeInTheDocument();
    expect(screen.getAllByText("Not reported").length).toBeGreaterThan(0);
    expect(screen.getByText("n = 4744")).toBeInTheDocument();
  });

  it("extracts evidence for an open paper and shows it as generated", async () => {
    mockFetch([]);
    render(
      <WorkspaceProvider>
        <SearchPane />
        <PaperDetail />
      </WorkspaceProvider>,
    );

    await openPaperDrawer();

    expect(await screen.findByText(/No structured evidence yet/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Extract" }));

    expect(await screen.findByText("Generated")).toBeInTheDocument();
    expect(screen.getByText(/LLM interpretation via deepseek-v4-flash/)).toBeInTheDocument();
    await waitFor(() => {
      const fetchMock = vi.mocked(fetch);
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes("/extract") &&
            (init as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true);
    });
  });
});
