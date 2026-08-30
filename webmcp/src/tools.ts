/**
 * The EvidenceOS WebMCP tool catalogue: name, description (the "prompt" the
 * agent sees), JSON Schema, and safety annotations for every tool the
 * workspace registers. The schema files under `schemas/` are the single
 * source of truth for input contracts; this module pairs each with tool-level
 * metadata.
 *
 * `execute` handlers deliberately live in the frontend (`src/lib/webmcp/`),
 * where they call the same API client the human UI uses — never a parallel
 * implementation.
 */

import type { JsonSchema, ToolAnnotations } from "./types.js";

import addPaperToReviewSchema from "../schemas/add_paper_to_review.schema.json" with { type: "json" };
import comparePapersSchema from "../schemas/compare_papers.schema.json" with { type: "json" };
import createReviewSchema from "../schemas/create_review.schema.json" with { type: "json" };
import extractEvidenceSchema from "../schemas/extract_evidence.schema.json" with { type: "json" };
import getEvidenceMatrixSchema from "../schemas/get_evidence_matrix.schema.json" with { type: "json" };
import getPaperSchema from "../schemas/get_paper.schema.json" with { type: "json" };
import removePaperFromReviewSchema from "../schemas/remove_paper_from_review.schema.json" with { type: "json" };
import searchLiteratureSchema from "../schemas/search_literature.schema.json" with { type: "json" };

/** Contract definition for one EvidenceOS WebMCP tool. */
export interface ToolContract {
  name: string;
  title: string;
  /** Written from the agent's perspective: what it does and when to use it. */
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotations;
}

/** Paper/reference input shared by get_paper and extract_evidence. */
export const referenceDescription =
  "A PubMed ID (PMID, number or digit string) or an EvidenceOS paper UUID.";

export const tools: readonly ToolContract[] = [
  {
    name: "search_literature",
    title: "Search literature",
    description:
      "Search the biomedical literature (PubMed) for papers matching a clinical question. " +
      "Returns a page of structured papers (PMID, title, authors, journal, publication date, DOI). " +
      "Use first when finding or screening primary studies for a review. Read-only.",
    inputSchema: searchLiteratureSchema as JsonSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: "get_paper",
    title: "Get paper",
    description:
      "Fetch full metadata for a single paper by PubMed ID (number or digit string) or " +
      "EvidenceOS paper UUID: title, abstract, authors, journal, publication date, DOI and URL. " +
      "Use to inspect a paper before adding it to a review. Read-only.",
    inputSchema: getPaperSchema as JsonSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: "create_review",
    title: "Create review",
    description:
      "Create a new evidence review for collecting and synthesizing papers. Requires a title; " +
      "an optional research question focuses the review. Returns the new review's UUID, which " +
      "other tools (add_paper_to_review, get_evidence_matrix) require. Mutates: creates a review.",
    inputSchema: createReviewSchema as JsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
  },
  {
    name: "add_paper_to_review",
    title: "Add paper to review",
    description:
      "Attach a paper (by PubMed ID) to an existing review (by UUID), optionally setting its " +
      "screening status and notes. Paper metadata is fetched from PubMed if not already cached. " +
      "Returns the new screening link including the internal paper UUID. Mutates: adds to the review.",
    inputSchema: addPaperToReviewSchema as JsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
  },
  {
    name: "remove_paper_from_review",
    title: "Remove paper from review",
    description:
      "Detach a paper (by EvidenceOS paper UUID) from a review (by UUID). The paper stays cached " +
      "in EvidenceOS; only the screening link is removed. Mutates: removes from the review.",
    inputSchema: removePaperFromReviewSchema as JsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
  },
  {
    name: "extract_evidence",
    title: "Extract evidence",
    description:
      "Run structured evidence extraction for a paper (by PubMed ID or paper UUID), producing " +
      "PICO plus study design, sample size, key finding, limitations and confidence. Results are " +
      "LLM-generated and labelled as such — verify against the source before relying. Mutates: " +
      "writes an extraction. Needs the LLM provider configured.",
    inputSchema: extractEvidenceSchema as JsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
  },
  {
    name: "get_evidence_matrix",
    title: "Get evidence matrix",
    description:
      "Return the evidence matrix for a review (by UUID): every attached paper with its current " +
      "screening status and its latest extracted evidence. Use to synthesize or check the state " +
      "of a review. Read-only.",
    inputSchema: getEvidenceMatrixSchema as JsonSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: "compare_papers",
    title: "Compare papers",
    description:
      "Compare structured evidence across 2–6 papers (by PubMed ID). Builds a deterministic " +
      "per-dimension side-by-side — population, intervention, comparison, outcome, study design, " +
      "sample size, key finding, limitations, confidence — flagging disagreements and gaps. " +
      "Papers without extraction are listed as not extracted. Read-only.",
    inputSchema: comparePapersSchema as JsonSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
];

/** All tool names in the catalogue. */
export const toolNames: readonly string[] = tools.map((tool) => tool.name);

/** Look a tool contract up by name. */
export function getTool(name: string): ToolContract | undefined {
  return tools.find((tool) => tool.name === name);
}
