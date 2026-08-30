/**
 * Real implementations of the EvidenceOS WebMCP tools. Every handler calls
 * the same API client the human UI uses (`src/lib/api.ts`) — there is no
 * parallel or mocked code path here. Results are plain JSON-serializable
 * objects; the registry stringifies them for the browser.
 */

import { api } from "@/lib/api";
import type { EvidenceExtraction, LiteraturePaper, MatrixPaper } from "@/lib/types";
import { ToolArgumentError } from "@/lib/webmcp/validate";

export interface ToolRunContext {
  signal?: AbortSignal;
}

/** A normalized `reference` input: either a PubMed ID or a paper UUID. */
export type References = { kind: "pmid"; pmid: number } | { kind: "uuid"; paperId: string };

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PMID_STRING_RE = /^[1-9][0-9]*$/;

/** Normalize a `reference` input to a PMID or an EvidenceOS paper UUID. */
export function resolveReference(reference: unknown): References {
  if (typeof reference === "number") {
    if (Number.isInteger(reference) && reference > 0) return { kind: "pmid", pmid: reference };
    throw new ToolArgumentError("reference must be a positive integer PubMed ID");
  }
  if (typeof reference === "string") {
    if (UUID_RE.test(reference)) return { kind: "uuid", paperId: reference };
    if (PMID_STRING_RE.test(reference)) return { kind: "pmid", pmid: Number(reference) };
  }
  throw new ToolArgumentError(
    "reference must be a PubMed ID (number or digit string) or an EvidenceOS paper UUID",
  );
}

/**
 * Execute one registered EvidenceOS tool for real. Throws `ToolArgumentError`
 * for invalid inputs and `ApiError` for backend failures.
 */
export async function runToolExecutor(
  name: string,
  input: Readonly<Record<string, unknown>>,
  context: ToolRunContext,
): Promise<unknown> {
  switch (name) {
    case "search_literature":
      return await searchLiterature(input, context);
    case "get_paper":
      return await getPaper(input, context);
    case "create_review":
      return await createReview(input, context);
    case "add_paper_to_review":
      return await addPaperToReview(input, context);
    case "remove_paper_from_review":
      return await removePaperFromReview(input, context);
    case "extract_evidence":
      return await extractEvidence(input, context);
    case "get_evidence_matrix":
      return await getEvidenceMatrix(input, context);
    case "compare_papers":
      return await comparePapers(input, context);
    default:
      throw new ToolArgumentError(`Unknown tool: ${name}`);
  }
}

/** Announce a data mutation so the live workspace re-reads state. */
export function dispatchDataChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("evidenceos:data-changed"));
  }
}

async function searchLiterature(
  input: Readonly<Record<string, unknown>>,
  { signal }: ToolRunContext,
): Promise<unknown> {
  const data = await api.searchLiterature(
    {
      q: String(input.query),
      page: asInt(input.page) ?? 1,
      page_size: asInt(input.page_size) ?? 25,
    },
    signal,
  );
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  return {
    tool: "search_literature",
    query: data.query,
    page: data.page,
    page_size: data.page_size,
    total: data.total,
    returned: data.items.length,
    next_page: data.page < pages ? data.page + 1 : null,
    papers: data.items.map((p) => ({
      pmid: p.pmid,
      title: p.title,
      journal: p.journal,
      publication_date: p.publication_date,
      year: p.publication_date ? p.publication_date.slice(0, 4) : null,
      authors: p.authors.slice(0, 20),
      doi: p.doi,
    })),
  };
}

async function getPaper(
  input: Readonly<Record<string, unknown>>,
  context: ToolRunContext,
): Promise<unknown> {
  const ref = resolveReference(input.reference);
  if (ref.kind === "uuid") {
    const paper = await api.getPaperByUuid(ref.paperId, context.signal);
    return {
      tool: "get_paper",
      paper: {
        pmid: paper.pmid,
        paper_id: paper.id,
        title: paper.title,
        abstract: paper.abstract,
        authors: paper.authors ?? [],
        journal: paper.journal,
        publication_date: paper.publication_date,
        doi: paper.doi,
        url: paper.url,
      },
    };
  }
  const paper = await api.getPaperByPmid(ref.pmid, context.signal);
  return {
    tool: "get_paper",
    paper: {
      pmid: paper.pmid,
      title: paper.title,
      abstract: paper.abstract,
      authors: paper.authors,
      journal: paper.journal,
      publication_date: paper.publication_date,
      doi: paper.doi,
      url: paper.url,
    },
  };
}

async function createReview(
  input: Readonly<Record<string, unknown>>,
  { signal }: ToolRunContext,
): Promise<unknown> {
  const review = await api.createReview(
    String(input.title),
    typeof input.research_question === "string" && input.research_question.trim()
      ? input.research_question
      : null,
    signal,
  );
  dispatchDataChanged();
  return {
    tool: "create_review",
    created: true,
    review: {
      id: review.id,
      title: review.title,
      research_question: review.research_question,
      created_at: review.created_at,
    },
  };
}

async function addPaperToReview(
  input: Readonly<Record<string, unknown>>,
  context: ToolRunContext,
): Promise<unknown> {
  const reviewId = String(input.review_id);
  const pmid = asPmid(input.pmid);
  const status = (input.status as "pending" | "screened" | "included" | "excluded") ?? "pending";
  const notes = typeof input.notes === "string" && input.notes.trim() ? input.notes : null;

  const link = await api.attachPaper(reviewId, pmid, status, notes, context.signal);

  let title: string | null = null;
  try {
    const paper = await api.getPaperByPmid(pmid, context.signal);
    title = paper.title;
  } catch {
    // Attach already succeeded; paper metadata is non-critical for the result.
  }
  dispatchDataChanged();
  return {
    tool: "add_paper_to_review",
    added: true,
    paper: { review_id: link.review_id, paper_id: link.paper_id, pmid, title },
    link: { status: link.status, notes: link.notes, created_at: link.created_at },
  };
}

async function removePaperFromReview(
  input: Readonly<Record<string, unknown>>,
  { signal }: ToolRunContext,
): Promise<unknown> {
  const reviewId = String(input.review_id);
  const paperId = String(input.paper_id);
  await api.removeReviewPaper(reviewId, paperId, signal);
  dispatchDataChanged();
  return {
    tool: "remove_paper_from_review",
    removed: true,
    review_id: reviewId,
    paper_id: paperId,
    note: "The paper stays cached in EvidenceOS; only its screening link was removed.",
  };
}

async function extractEvidence(
  input: Readonly<Record<string, unknown>>,
  { signal }: ToolRunContext,
): Promise<unknown> {
  const ref = resolveReference(input.reference);
  const reference = ref.kind === "pmid" ? ref.pmid : ref.paperId;
  const extraction = await api.extractEvidence(reference, signal);
  dispatchDataChanged();
  return {
    tool: "extract_evidence",
    generated: true,
    extraction: summarizeExtraction(extraction),
    caution:
      "LLM-generated evidence — verify each field against the source paper before relying on it.",
  };
}

async function getEvidenceMatrix(
  input: Readonly<Record<string, unknown>>,
  { signal }: ToolRunContext,
): Promise<unknown> {
  const matrix = await api.getReviewMatrix(String(input.review_id), signal);
  return {
    tool: "get_evidence_matrix",
    review: {
      id: matrix.review.id,
      title: matrix.review.title,
      research_question: matrix.review.research_question,
    },
    total_papers: matrix.total_papers,
    included_papers: matrix.included_papers,
    papers: matrix.papers.map(summarizeMatrixPaper),
  };
}

async function comparePapers(
  input: Readonly<Record<string, unknown>>,
  { signal }: ToolRunContext,
): Promise<unknown> {
  const references = (input.references as unknown[]).map(asPmid);
  const rows: Array<{ pmid: number; paper: LiteraturePaper; extractions: EvidenceExtraction[] }> =
    [];
  for (const pmid of references) {
    const paper = await api.getPaperByPmid(pmid, signal);
    const extractions = await api.getEvidence(pmid, signal);
    rows.push({ pmid, paper, extractions });
  }

  const latest = rows.map((row) => ({
    pmid: row.pmid,
    extraction: latestExtraction(row.extractions),
  }));
  const dimensions: Array<{
    dimension: string;
    consistent: boolean;
    present: boolean;
    values: Array<{ pmid: number; value: unknown; missing: boolean }>;
  }> = DIMENSIONS.map((dimension) => {
    const values = latest.map((entry) => ({
      pmid: entry.pmid,
      value: entry.extraction ? (entry.extraction[dimension] ?? null) : null,
      missing: !entry.extraction,
    }));
    const present = values.some((v) => v.value !== null && v.value !== undefined);
    const distinct = new Set(
      values
        .filter((v) => v.value !== null && v.value !== undefined)
        .map((v) => String(normalizeDimension(v.value))),
    );
    return { dimension, consistent: distinct.size <= 1, present, values };
  });

  const disagreements = dimensions
    .filter((d) => d.present && !d.consistent)
    .map((d) => ({
      dimension: d.dimension,
      values: d.values.map((v) => ({ pmid: v.pmid, value: v.value })),
    }));

  const gaps = rows
    .filter((row) => row.extractions.length === 0)
    .map((row) => ({ pmid: row.pmid, title: row.paper.title }));

  return {
    tool: "compare_papers",
    compared_at: new Date().toISOString(),
    papers: rows.map((row) => ({
      pmid: row.pmid,
      title: row.paper.title,
      journal: row.paper.journal,
      publication_date: row.paper.publication_date,
      extracted: row.extractions.length > 0,
    })),
    dimensions,
    disagreements,
    gaps,
    summary: {
      papers_compared: rows.length,
      disagreement_dimensions: disagreements.length,
      papers_without_extraction: gaps.length,
    },
  };
}

const DIMENSIONS = [
  "population",
  "intervention",
  "comparison",
  "outcome",
  "study_design",
  "sample_size",
  "key_finding",
  "limitations",
  "confidence",
] as const;

function latestExtraction(rows: EvidenceExtraction[]): EvidenceExtraction | null {
  if (rows.length === 0) return null;
  return (
    [...rows].sort((a, b) => {
      const byDate = b.created_at.localeCompare(a.created_at);
      return byDate !== 0 ? byDate : b.id.localeCompare(a.id);
    })[0] ?? null
  );
}

function summarizeExtraction(e: EvidenceExtraction): {
  id: string;
  paper_id: string;
  origin: string;
  model_name: string | null;
  confidence: string | null;
  summary: {
    population: string | null;
    intervention: string | null;
    comparison: string | null;
    outcome: string | null;
    study_design: string | null;
    sample_size: number | null;
    key_finding: string | null;
    limitations: string | null;
  };
  created_at: string;
} {
  return {
    id: e.id,
    paper_id: e.paper_id,
    origin: e.origin,
    model_name: e.model_name,
    confidence: e.confidence,
    summary: {
      population: e.population,
      intervention: e.intervention,
      comparison: e.comparison,
      outcome: e.outcome,
      study_design: e.study_design,
      sample_size: e.sample_size,
      key_finding: e.key_finding,
      limitations: e.limitations,
    },
    created_at: e.created_at,
  };
}

function summarizeMatrixPaper(p: MatrixPaper): {
  id: string;
  pmid: number;
  title: string;
  status: string;
  notes: string | null;
  extractions: number;
  latest_extraction: ReturnType<typeof summarizeExtraction> | null;
} {
  const latest = latestExtraction(p.extractions);
  return {
    id: p.id,
    pmid: p.pmid,
    title: p.title,
    status: p.status,
    notes: p.notes,
    extractions: p.extractions.length,
    latest_extraction: latest ? summarizeExtraction(latest) : null,
  };
}

function normalizeDimension(value: unknown): unknown {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

function asInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function asPmid(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  throw new ToolArgumentError("pmid must be a positive integer");
}
