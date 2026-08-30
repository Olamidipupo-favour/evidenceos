# WebMCP tool schemas

JSON Schema (draft 2020-12) contracts for the tools EvidenceOS exposes to
in-browser agents. Each tool's `execute` handler funnels into the same backend
API the human UI uses — never a parallel implementation.

Tools registered by EvidenceOS:

| Tool                       | Purpose                                                | Read-only |
| -------------------------- | ------------------------------------------------------ | --------- |
| `search_literature`        | Query PubMed via the backend, return structured papers | Yes       |
| `get_paper`                | Fetch full metadata/abstract for a single paper        | Yes       |
| `create_review`            | Start a new evidence review                            | No        |
| `add_paper_to_review`      | Attach a screened paper to a review                    | No        |
| `remove_paper_from_review` | Detach a paper from a review                           | No        |
| `extract_evidence`         | Run the structured LLM evidence extraction for a paper | No        |
| `get_evidence_matrix`      | Return the structured evidence matrix for a review     | Yes       |
| `compare_papers`           | Side-by-side comparison of evidence across papers      | Yes       |

Conventions:

- `description` is written as the instruction an agent sees when deciding
  whether to call the tool — say what it is for and when to use it.
- `additionalProperties: false` keeps agent arguments static-verifiable.
- UUIDs (review, paper) use the `^[0-9a-fA-F]{8}-…` pattern; paper references
  elsewhere accept a numeric PubMed ID or its digit-string form.
- Read-only tools set `annotations.readOnlyHint: true`; mutating tools set it
  to `false` and `extract_evidence` additionally sets
  `untrustedContentHint: true`.

These schemas are the single source of truth: the frontend validator
(`frontend/src/lib/webmcp/validate.ts`) implements enough of the spec to verify
agent inputs against them before any execution happens.
