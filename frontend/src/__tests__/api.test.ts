import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "@/lib/api";

const searchBody = {
  query: "metformin",
  page: 1,
  page_size: 25,
  total: 1,
  items: [
    {
      pmid: 174596,
      title: "Effect of intensive blood-glucose control with metformin on complications",
      abstract: null,
      authors: ["UKPDS Group"],
      journal: "The Lancet",
      publication_date: "1998-09-12",
      doi: "10.1016/S0140-6736(98)07019-9",
      url: "https://pubmed.ncbi.nlm.nih.gov/9742976/",
    },
  ],
};

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches literature and normalises the payload", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(searchBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await api.searchLiterature({ q: "metformin", page_size: 25 });

    expect(result.total).toBe(1);
    expect(result.items[0]?.pmid).toBe(174596);
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("/api/search");
    expect(calledUrl).toContain("q=metformin");
  });

  it("maps 422 validation detail objects to a readable message", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: [
            {
              loc: ["body", "title"],
              msg: "String should have at least 1 character",
              type: "string_too_short",
            },
          ],
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(api.createReview("", null)).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("at least 1 character"),
    } as Partial<ApiError>);
  });

  it("throws a readable error when the backend is unreachable", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await expect(api.health()).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining("Cannot reach the EvidenceOS API"),
    } as Partial<ApiError>);
  });

  it("resolves 204 deletes", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(api.deleteReview("review-1")).resolves.toBeUndefined();
  });

  it("extracts evidence via the LLM endpoint", async () => {
    const fetchMock = vi.mocked(fetch);
    const generated = {
      id: "evt-2",
      paper_id: "pap-1",
      population: "Adults with type 2 diabetes",
      intervention: "Dapagliflozin 10 mg",
      comparison: null,
      outcome: "3-point MACE",
      study_design: "Randomized controlled trial",
      sample_size: 4744,
      key_finding: "HR 0.86 (95% CI 0.73-1.00) for MACE",
      limitations: null,
      confidence: "high",
      origin: "llm",
      model_name: "deepseek-v4-flash",
      created_at: "2026-08-30T12:00:00Z",
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(generated), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await api.extractEvidence(174596);

    expect(result.origin).toBe("llm");
    expect(result.model_name).toBe("deepseek-v4-flash");
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    const calledInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(calledUrl).toContain(`/api/papers/174596/extract`);
    expect(calledInit.method).toBe("POST");
  });

  it("lists evidence for a paper", async () => {
    const fetchMock = vi.mocked(fetch);
    const manual = {
      id: "evt-1",
      paper_id: "pap-1",
      population: "Adults with type 2 diabetes",
      intervention: "Dapagliflozin 10 mg",
      comparison: null,
      outcome: "3-point MACE",
      study_design: null,
      sample_size: 4744,
      key_finding: "HR 0.86 (95% CI 0.73-1.00) for MACE",
      limitations: null,
      confidence: "medium",
      origin: "manual",
      model_name: null,
      created_at: "2026-08-30T12:00:00Z",
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([manual]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const rows = await api.getEvidence(174596);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.origin).toBe("manual");
    expect(rows[0]?.model_name).toBeNull();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/api/papers/174596/evidence`);
  });
});
