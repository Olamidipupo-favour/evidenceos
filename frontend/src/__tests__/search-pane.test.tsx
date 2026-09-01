import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SearchPane } from "@/components/search-pane";
import { WorkspaceProvider } from "@/lib/workspace";

const searchBody = {
  query: "metformin",
  page: 1,
  page_size: 25,
  total: 2,
  items: [
    {
      pmid: 174596,
      title: "Effect of intensive blood-glucose control with metformin on complications",
      abstract: "A randomised trial in overweight patients with type 2 diabetes.",
      authors: ["UKPDS Group"],
      journal: "The Lancet",
      publication_date: "1998-09-12",
      doi: "10.1016/S0140-6736(98)07019-9",
      url: "https://pubmed.ncbi.nlm.nih.gov/9742976/",
    },
    {
      pmid: 15793220,
      title: "Metformin in polycystic ovary syndrome: systematic review",
      abstract: "Systematic review of randomised trials.",
      authors: ["Lord JM", "Flight IH", "Norman RJ"],
      journal: "BMJ",
      publication_date: "2003-01-01",
      doi: null,
      url: "https://pubmed.ncbi.nlm.nih.gov/15793220/",
    },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("SearchPane", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/health")) return Promise.resolve(json({ status: "ok" }));
        if (url.includes("/api/reviews")) return Promise.resolve(json([]));
        if (url.includes("/api/search")) return Promise.resolve(json(searchBody));
        return Promise.resolve(json({ detail: "Not found" }, 404));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs a PubMed search and lists the results", async () => {
    render(
      <WorkspaceProvider>
        <SearchPane />
      </WorkspaceProvider>,
    );

    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "metformin type 2 diabetes" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByText(/Effect of intensive blood-glucose control/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Metformin in polycystic ovary syndrome/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/2 results · page 1 of 1/i)).toBeInTheDocument());
  });

  it("shows a helpful empty state before the first search", async () => {
    render(
      <WorkspaceProvider>
        <SearchPane />
      </WorkspaceProvider>,
    );

    expect(await screen.findByText("Find primary studies")).toBeInTheDocument();
  });

  it("clears the query and results with the Clear button", async () => {
    render(
      <WorkspaceProvider>
        <SearchPane />
      </WorkspaceProvider>,
    );

    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "metformin type 2 diabetes" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByText(/Effect of intensive blood-glucose control/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear search results" }));

    expect(await screen.findByText("Find primary studies")).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear search results" })).not.toBeInTheDocument();
    expect(screen.queryByText(/results · page/i)).not.toBeInTheDocument();
  });
});
