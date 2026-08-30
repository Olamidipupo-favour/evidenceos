# WebMCP tool schemas

JSON Schema contracts for the tools EvidenceOS exposes to in-browser agents.
Each tool's `execute` handler will funnel into the same application logic the
human UI uses — never a parallel implementation.

Draft tools planned for the WebMCP layer:

| Tool                    | Purpose                                                  | Mutating? |
| ----------------------- | -------------------------------------------------------- | --------- |
| `search_literature`     | Query PubMed via the backend, return structured papers   | No        |
| `get_paper`             | Fetch full metadata/abstract for a single paper          | No        |
| `create_review`         | Start a new evidence review                              | Yes       |
| `add_paper_to_review`   | Attach a screened paper to a review                      | Yes       |
| `build_evidence_matrix` | Emit/refresh the structured evidence matrix for a review | No        |
| `export_review`         | Export a review (markdown/CSV) for citation in a report  | No        |

Conventions:

- `description` is written as the instruction an agent sees when deciding
  whether to call the tool — say what it is for and when to use it.
- `additionalProperties: false` keeps agent arguments static-verifiable.
- Read-only tools may become declarative HTML form tools (see
  `docs/webmcp.md`); mutating tools keep `toolautosubmit` off so a human
  confirms each action.
