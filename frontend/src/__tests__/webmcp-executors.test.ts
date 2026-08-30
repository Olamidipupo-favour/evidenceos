import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runToolExecutor, resolveReference } from "@/lib/webmcp/executors";
import { ToolArgumentError } from "@/lib/webmcp/validate";

const PAPER_1 = {
  pmid: 174596,
  title: "Effect of intensive blood-glucose control with metformin on complications",
  abstract: "Randomised controlled trial of intensive control in overweight patients.",
  authors: ["UKPDS Group"],
  journal: "The Lancet",
  publication_date: "1998-09-12",
  doi: "10.1016/S0140-6736(98)07019-9",
  url: "https://pubmed.ncbi.nlm.nih.gov/9742976/",
};

const PAPER_2 = {
  pmid: 74576,
  title: "Metformin versus insulin in gestational diabetes",
  abstract: "A randomized comparison of metformin and insulin.",
  authors: ["Rowan JA"],
  journal: "NEJM",
  publication_date: "2008-05-08",
  doi: "10.1056/NEJMoa0707193",
  url: "https://pubmed.ncbi.nlm.nih.gov/18463375/",
};

const EXTRACTION_1 = {
  id: "evt-1",
  paper_id: "pap-1",
  population: "Adults with type 2 diabetes",
  intervention: "Metformin 850 mg twice daily",
  comparison: "Standard diet alone",
  outcome: "All-cause mortality and HbA1c",
  study_design: "Randomized controlled trial",
  sample_size: 1704,
  key_finding: "Metformin reduced all-cause mortality by 36% vs diet alone",
  limitations: "Open-label",
  confidence: "medium",
  origin: "llm",
  model_name: "deepseek-v4-flash",
  created_at: "2026-08-30T10:00:00Z",
};

const EXTRACTION_2 = {
  id: "evt-2",
  paper_id: "pap-2",
  population: "Women with gestational diabetes",
  intervention: "Metformin 500 mg twice daily",
  comparison: "Insulin",
  outcome: "Composite adverse outcome",
  study_design: "Randomized controlled trial",
  sample_size: 751,
  key_finding: "No significant difference in the composite outcome",
  limitations: "Open-label",
  confidence: "high",
  origin: "manual",
  model_name: null,
  created_at: "2026-08-30T11:00:00Z",
};

const REVIEW = {
  id: "3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c",
  title: "Metformin in diabetes",
  research_question: "Does metformin improve outcomes?",
  created_at: "2026-08-30T12:00:00Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function decodeBody(init: RequestInit | undefined): unknown {
  return init?.body ? JSON.parse(String(init.body)) : null;
}

let fetchMock: ReturnType<typeof vi.fn>;

/** Route mocked fetch by URL substring to a responder. */
function mockFetch(routes: Record<string, () => Response | Promise<Response>>) {
  fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    for (const [needle, responder] of Object.entries(routes)) {
      if (url.includes(needle)) {
        const response = await responder();
        return response.status === 204 ? new Response(null, { status: 204 }) : response;
      }
    }
    return new Response(JSON.stringify({ detail: "not stubbed" }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
}

const signal = new AbortController().signal;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveReference", () => {
  it("normalizes pmid numbers, digit strings and uuids", () => {
    expect(resolveReference(174596)).toEqual({ kind: "pmid", pmid: 174596 });
    expect(resolveReference("174596")).toEqual({ kind: "pmid", pmid: 174596 });
    expect(resolveReference("3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c")).toEqual({
      kind: "uuid",
      paperId: "3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c",
    });
    expect(() => resolveReference("oops")).toThrow(ToolArgumentError);
    expect(() => resolveReference({})).toThrow(ToolArgumentError);
  });
});

describe("search_literature", () => {
  it("queries the real search endpoint and returns normalized papers", async () => {
    mockFetch({
      "/api/search": () =>
        jsonResponse({
          query: "metformin",
          page: 1,
          page_size: 25,
          total: 2,
          items: [PAPER_1, PAPER_2],
        }),
    });

    const result = (await runToolExecutor(
      "search_literature",
      { query: "metformin", page_size: 25 },
      { signal },
    )) as { papers: Array<typeof PAPER_1 & { year: string }>; next_page: number | null };

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/search");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("q=metformin");
    expect(result.papers).toHaveLength(2);
    expect(result.papers[0]?.year).toBe("1998");
    expect(result.next_page).toBeNull();
  });
});

describe("get_paper", () => {
  it("fetches by pmid", async () => {
    mockFetch({ "/api/papers/174596": () => jsonResponse(PAPER_1) });

    const result = (await runToolExecutor("get_paper", { reference: 174596 }, { signal })) as {
      paper: { pmid: number; paper_id?: string };
    };

    expect(result.paper.pmid).toBe(174596);
    expect(result.paper.paper_id).toBeUndefined();
  });

  it("fetches by internal uuid with the paper id", async () => {
    const withId = { ...PAPER_1, id: "3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c" };
    mockFetch({ "/papers/3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c": () => jsonResponse(withId) });

    const result = (await runToolExecutor(
      "get_paper",
      { reference: "3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c" },
      { signal },
    )) as { paper: { pmid: number; paper_id: string } };

    expect(result.paper).toMatchObject({ pmid: 174596, title: withId.title });
    expect(result.paper.paper_id).toBe("3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c");
  });
});

describe("create_review", () => {
  it("posts to the reviews endpoint", async () => {
    let captured: RequestInit | undefined;
    mockFetch({
      "/api/reviews": () => {
        captured = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
        return jsonResponse(REVIEW, 201);
      },
    });

    const result = (await runToolExecutor(
      "create_review",
      { title: "Metformin in diabetes", research_question: "Does metformin improve outcomes?" },
      { signal },
    )) as { created: boolean; review: { id: string } };

    expect(captured?.method).toBe("POST");
    expect(decodeBody(captured)).toEqual({
      title: "Metformin in diabetes",
      research_question: "Does metformin improve outcomes?",
    });
    expect(result.created).toBe(true);
    expect(result.review.id).toBe(REVIEW.id);
  });
});

describe("add_paper_to_review", () => {
  it("attaches a paper and returns the link plus title", async () => {
    mockFetch({
      "/api/reviews/3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c/papers": () =>
        jsonResponse(
          {
            review_id: REVIEW.id,
            paper_id: "pap-1",
            status: "pending",
            notes: null,
            created_at: "2026-08-30T12:00:00Z",
          },
          201,
        ),
      "/api/papers/174596": () => jsonResponse(PAPER_1),
    });

    const result = (await runToolExecutor(
      "add_paper_to_review",
      { review_id: REVIEW.id, pmid: 174596 },
      { signal },
    )) as { added: boolean; paper: { paper_id: string; pmid: number; title: string } };

    expect(result.added).toBe(true);
    expect(result.paper).toMatchObject({ paper_id: "pap-1", pmid: 174596, title: PAPER_1.title });
  });
});

describe("remove_paper_from_review", () => {
  it("deletes the screening link", async () => {
    mockFetch({
      "/api/reviews/3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c/papers/pap-1": () =>
        new Response(null, { status: 204 }),
    });

    const result = (await runToolExecutor(
      "remove_paper_from_review",
      { review_id: REVIEW.id, paper_id: "pap-1" },
      { signal },
    )) as { removed: boolean };

    expect(result.removed).toBe(true);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("DELETE");
  });
});

describe("extract_evidence", () => {
  it("runs the LLM extraction endpoint and flags the result as generated", async () => {
    mockFetch({ "/api/papers/174596/extract": () => jsonResponse(EXTRACTION_1, 201) });

    const result = (await runToolExecutor(
      "extract_evidence",
      { reference: 174596 },
      { signal },
    )) as { generated: boolean; extraction: { model_name: string; confidence: string } };

    expect(result.generated).toBe(true);
    expect(result.extraction.model_name).toBe("deepseek-v4-flash");
    expect(result.extraction.confidence).toBe("medium");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");
  });

  it("surfaces LLM/API failures to the caller", async () => {
    mockFetch({
      "/api/papers/174596/extract": () => jsonResponse({ detail: "LLM provider unavailable" }, 503),
    });

    await expect(
      runToolExecutor("extract_evidence", { reference: 174596 }, { signal }),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe("get_evidence_matrix", () => {
  it("returns a bounded matrix summary", async () => {
    const matrix = {
      review: REVIEW,
      total_papers: 1,
      included_papers: 1,
      papers: [
        {
          ...PAPER_1,
          id: "pap-1",
          status: "included",
          notes: null,
          extractions: [EXTRACTION_1],
        },
      ],
    };
    mockFetch({
      "/api/reviews/3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c/matrix": () => jsonResponse(matrix),
    });

    const result = (await runToolExecutor(
      "get_evidence_matrix",
      { review_id: REVIEW.id },
      { signal },
    )) as {
      total_papers: number;
      papers: Array<{ extractions: number; latest_extraction: unknown }>;
    };

    expect(result.total_papers).toBe(1);
    expect(result.papers[0]?.extractions).toBe(1);
    expect(result.papers[0]?.latest_extraction).toBeTruthy();
  });
});

describe("compare_papers", () => {
  it("builds a deterministic side-by-side comparison from real data", async () => {
    mockFetch({
      "/api/papers/174596/evidence": () => jsonResponse([EXTRACTION_1]),
      "/api/papers/74576/evidence": () => jsonResponse([EXTRACTION_2]),
      "/api/papers/174596": () => jsonResponse(PAPER_1),
      "/api/papers/74576": () => jsonResponse(PAPER_2),
    });

    const run = () =>
      runToolExecutor("compare_papers", { references: [174596, 74576] }, { signal }) as Promise<{
        papers: Array<{ pmid: number; extracted: boolean }>;
        dimensions: Array<{ dimension: string; consistent: boolean; present: boolean }>;
        disagreements: Array<{ dimension: string }>;
        gaps: Array<{ pmid: number }>;
        summary: { papers_compared: number };
        compared_at: string;
      }>;

    const first = await run();
    const second = await run();

    expect(first.papers).toHaveLength(2);
    expect(first.papers.map((p) => p.pmid)).toEqual([174596, 74576]);
    expect(first.summary.papers_compared).toBe(2);
    expect(first.disagreements.length).toBeGreaterThan(0);
    expect(first.gaps).toHaveLength(0);
    // Deterministic across runs (ignore the run timestamp).
    expect(second).toEqual({ ...first, compared_at: second.compared_at });
  });

  it("flags papers without extraction as gaps", async () => {
    mockFetch({
      "/api/papers/174596/evidence": () => jsonResponse([]),
      "/api/papers/74576/evidence": () => jsonResponse([]),
      "/api/papers/174596": () => jsonResponse(PAPER_1),
      "/api/papers/74576": () => jsonResponse(PAPER_2),
    });

    const result = (await runToolExecutor(
      "compare_papers",
      { references: [174596, 74576] },
      { signal },
    )) as { gaps: Array<{ pmid: number }>; summary: { papers_without_extraction: number } };

    expect(result.gaps).toHaveLength(2);
    expect(result.summary.papers_without_extraction).toBe(2);
  });
});

describe("runToolExecutor guard", () => {
  it("rejects unknown tool names", async () => {
    await expect(runToolExecutor("not_a_real_tool", {}, { signal })).rejects.toThrow(
      ToolArgumentError,
    );
  });
});
