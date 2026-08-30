/** Domain types mirroring the EvidenceOS FastAPI backend. */

export type ScreeningStatus = "pending" | "screened" | "included" | "excluded";
export type Confidence = "low" | "medium" | "high";

export type ReviewStatus = ScreeningStatus;

export interface LiteraturePaper {
  pmid: number;
  title: string;
  abstract: string | null;
  authors: string[];
  journal: string | null;
  publication_date: string | null;
  doi: string | null;
  url: string | null;
}

export interface SearchResponse {
  query: string;
  page: number;
  page_size: number;
  total: number;
  items: LiteraturePaper[];
}

export interface EvidenceExtraction {
  id: string;
  paper_id: string;
  population: string | null;
  intervention: string | null;
  comparison: string | null;
  outcome: string | null;
  study_design: string | null;
  sample_size: number | null;
  key_finding: string | null;
  limitations: string | null;
  confidence: Confidence | null;
  created_at: string;
}

export interface Review {
  id: string;
  title: string;
  research_question: string | null;
  created_at: string;
}

export interface ReviewPaperLink {
  review_id: string;
  paper_id: string;
  status: ScreeningStatus;
  notes: string | null;
  created_at: string;
}

export interface MatrixPaper extends LiteraturePaper {
  id: string;
  status: ScreeningStatus;
  notes: string | null;
  extractions: EvidenceExtraction[];
}

export interface ReviewMatrix {
  review: Review;
  total_papers: number;
  included_papers: number;
  papers: MatrixPaper[];
}

export interface ExtractionInput {
  population?: string | null;
  intervention?: string | null;
  comparison?: string | null;
  outcome?: string | null;
  study_design?: string | null;
  sample_size?: number | null;
  key_finding?: string | null;
  limitations?: string | null;
  confidence?: Confidence | null;
}

export interface ActivityEntry {
  id: string;
  at: string;
  kind: "search" | "add" | "screen" | "note" | "remove" | "evidence" | "review";
  message: string;
  tone: "neutral" | "accent" | "positive" | "warning";
}
