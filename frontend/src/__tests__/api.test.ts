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
});
