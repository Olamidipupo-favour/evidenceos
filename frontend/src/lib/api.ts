/** Typed client for the EvidenceOS FastAPI backend. */

import type {
  EvidenceExtraction,
  ExtractionInput,
  LiteraturePaper,
  Review,
  ReviewMatrix,
  ReviewPaperLink,
  ScreeningStatus,
  SearchResponse,
} from "@/lib/types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(
  /\/$/,
  "",
);

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string | string[] | null;

  constructor(status: number, message: string, detail: string | string[] | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function detailToMessage(detail: string | string[] | null | undefined, fallback: string): string {
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : entry && typeof entry === "object" && "msg" in (entry as object)
            ? String((entry as { msg: unknown }).msg)
            : String(entry),
      )
      .join("; ");
  }
  if (typeof detail === "string" && detail.trim()) return detail;
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(
      0,
      "Cannot reach the EvidenceOS API. Check that the backend is running on " +
        `${API_URL} and try again.`,
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = body?.detail;
    const message = detailToMessage(detail, `Request failed with HTTP ${response.status}.`);
    throw new ApiError(response.status, message, detail ?? null);
  }
  return body as T;
}

interface SearchParams {
  q: string;
  page?: number;
  page_size?: number;
}

const queryString = (params: SearchParams): string => {
  const search = new URLSearchParams();
  search.set("q", params.q);
  if (params.page) search.set("page", String(params.page));
  if (params.page_size) search.set("page_size", String(params.page_size));
  return `?${search.toString()}`;
};

export const api = {
  health: () => request<{ status: string }>("/health"),

  // Reviews
  listReviews: () => request<Review[]>("/api/reviews"),
  createReview: (title: string, researchQuestion: string | null) =>
    request<Review>("/api/reviews", {
      method: "POST",
      body: JSON.stringify({ title, research_question: researchQuestion || null }),
    }),
  updateReview: (reviewId: string, patch: { title?: string; research_question?: string | null }) =>
    request<Review>(`/api/reviews/${reviewId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteReview: (reviewId: string) =>
    request<void>(`/api/reviews/${reviewId}`, { method: "DELETE" }),

  // Literature
  searchLiterature: (params: SearchParams) =>
    request<SearchResponse>(`/api/search${queryString(params)}`),
  getPaperByPmid: (pmid: number) => request<LiteraturePaper>(`/api/papers/${pmid}`),

  // Review workspace
  attachPaper: (
    reviewId: string,
    pmid: number,
    status: ScreeningStatus = "pending",
    notes: string | null = null,
  ) =>
    request<ReviewPaperLink>(`/api/reviews/${reviewId}/papers`, {
      method: "POST",
      body: JSON.stringify({ pmid, status, notes }),
    }),
  updateReviewPaper: (
    reviewId: string,
    paperId: string,
    patch: { status?: ScreeningStatus; notes?: string | null },
  ) =>
    request<ReviewPaperLink>(`/api/reviews/${reviewId}/papers/${paperId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  removeReviewPaper: (reviewId: string, paperId: string) =>
    request<void>(`/api/reviews/${reviewId}/papers/${paperId}`, { method: "DELETE" }),
  getReviewMatrix: (reviewId: string) => request<ReviewMatrix>(`/api/reviews/${reviewId}/matrix`),

  // Evidence
  createExtraction: (paperId: string, input: ExtractionInput) =>
    request<EvidenceExtraction>(`/papers/${paperId}/evidence-extractions`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
