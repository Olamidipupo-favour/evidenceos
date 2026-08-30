"use client";

import { useState, type FormEvent } from "react";

import { ArrowUpRight, FlaskConical, Plus, StickyNote } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardSection } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfidenceBadge, SCREENING_LABELS, StatusBadge } from "@/components/status-badge";
import type { Confidence, LiteraturePaper, MatrixPaper, ScreeningStatus } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const STATUSES: ScreeningStatus[] = ["pending", "screened", "included", "excluded"];

function MetaLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-0.5 truncate text-[0.8125rem] font-medium text-signal hover:underline"
    >
      {label}
      <ArrowUpRight className="size-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

function ScreeningCard({ matrixPaper }: { matrixPaper: MatrixPaper }) {
  const { setScreening } = useWorkspace();
  return (
    <Card>
      <CardContent className="space-y-3 px-4 py-4">
        <CardSection title="Screening" />
        <div
          role="group"
          aria-label="Screening status"
          className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1"
        >
          {STATUSES.map((status) => {
            const active = matrixPaper.status === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => void setScreening(matrixPaper.id, status)}
                className={cn(
                  "h-7 rounded-md text-xs font-medium transition-colors",
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {SCREENING_LABELS[status]}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function NotesCard({ matrixPaper }: { matrixPaper: MatrixPaper }) {
  const { setNotes } = useWorkspace();
  const [draft, setDraft] = useState(matrixPaper.notes ?? "");
  const dirty = draft !== (matrixPaper.notes ?? "");

  return (
    <Card>
      <CardContent className="space-y-2.5 px-4 py-4">
        <CardSection title="Notes" />
        <Textarea
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Relevance to the question, strengths, caveats…"
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void setNotes(matrixPaper.id, draft)} disabled={!dirty}>
            <StickyNote className="size-3.5" aria-hidden="true" />
            Save notes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EvidenceCard({ matrixPaper }: { matrixPaper: MatrixPaper }) {
  const { addExtraction } = useWorkspace();
  const [open, setOpen] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const read = (name: string) => (form[name] as HTMLInputElement | null)?.value.trim() || null;
    void addExtraction(matrixPaper.id, {
      population: read("population"),
      intervention: read("intervention"),
      outcome: read("outcome"),
      key_finding: read("key_finding"),
      sample_size: read("sample_size") ? Number(read("sample_size")) : null,
      confidence: (form.confidence as HTMLSelectElement).value as Confidence,
    });
    form.reset();
    setOpen(false);
  };

  return (
    <Card>
      <CardContent className="space-y-3 px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FlaskConical className="size-4 text-muted-foreground" aria-hidden="true" />
            <h4 className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Evidence
            </h4>
          </div>
          {matrixPaper.extractions.length > 0 ? (
            <Badge variant="soft">{matrixPaper.extractions.length}</Badge>
          ) : null}
        </div>

        {matrixPaper.extractions.length === 0 ? (
          <p className="text-[0.8125rem] text-muted-foreground">
            No extractions yet. Record structured findings below to populate the synthesis matrix.
          </p>
        ) : (
          <div className="space-y-3">
            {matrixPaper.extractions.map((extraction) => (
              <div
                key={extraction.id}
                className="space-y-1.5 rounded-lg border border-border/60 p-3"
              >
                <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[0.75rem]">
                  <span className="font-medium text-muted-foreground">Population</span>
                  <span className="text-muted-foreground">{extraction.population ?? "—"}</span>
                  <span className="font-medium text-muted-foreground">Intervention</span>
                  <span className="text-muted-foreground">{extraction.intervention ?? "—"}</span>
                  <span className="font-medium text-muted-foreground">Outcome</span>
                  <span className="text-muted-foreground">{extraction.outcome ?? "—"}</span>
                </div>
                {extraction.key_finding ? (
                  <p className="border-t border-border/40 pt-1.5 text-[0.8125rem] leading-relaxed text-foreground/90">
                    {extraction.key_finding}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[0.6875rem] text-muted-foreground">
                  {extraction.confidence ? (
                    <ConfidenceBadge confidence={extraction.confidence} />
                  ) : null}
                  {extraction.sample_size ? <span>n = {extraction.sample_size}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {open ? (
          <form onSubmit={submit} className="space-y-3 rounded-lg border border-border/60 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label
                  className="text-[0.6875rem] font-medium text-muted-foreground"
                  htmlFor="f-pop"
                >
                  Population
                </label>
                <Input id="f-pop" name="population" placeholder="Adults with T2D, n=…" />
              </div>
              <div className="space-y-1">
                <label
                  className="text-[0.6875rem] font-medium text-muted-foreground"
                  htmlFor="f-int"
                >
                  Intervention
                </label>
                <Input id="f-int" name="intervention" placeholder="Dapagliflozin 10 mg" />
              </div>
              <div className="space-y-1">
                <label
                  className="text-[0.6875rem] font-medium text-muted-foreground"
                  htmlFor="f-out"
                >
                  Outcome
                </label>
                <Input id="f-out" name="outcome" placeholder="3-point MACE" />
              </div>
              <div className="space-y-1">
                <label
                  className="text-[0.6875rem] font-medium text-muted-foreground"
                  htmlFor="f-samp"
                >
                  Sample size
                </label>
                <Input id="f-samp" name="sample_size" type="number" min={0} placeholder="4744" />
              </div>
            </div>
            <div className="space-y-1">
              <label
                className="text-[0.6875rem] font-medium text-muted-foreground"
                htmlFor="f-find"
              >
                Key finding
              </label>
              <Textarea
                id="f-find"
                name="key_finding"
                rows={3}
                placeholder="HR 0.86 (95% CI 0.73–1.00) for MACE with dapagliflozin vs placebo."
              />
            </div>
            <div className="space-y-1">
              <label
                className="text-[0.6875rem] font-medium text-muted-foreground"
                htmlFor="f-conf"
              >
                Confidence
              </label>
              <select
                id="f-conf"
                name="confidence"
                defaultValue="medium"
                className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm">
                <FlaskConical className="size-3.5" aria-hidden="true" />
                Record finding
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="soft" size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
            Add extraction
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function DetailBody({
  paper,
  matrixPaper,
  onClose,
}: {
  paper: LiteraturePaper;
  matrixPaper: MatrixPaper | null;
  onClose: () => void;
}) {
  const { addPaperToReview } = useWorkspace();

  return (
    <div className="space-y-5 p-5">
      <section className="space-y-2.5">
        <h2 className="text-lg font-semibold leading-snug tracking-tight">{paper.title}</h2>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted-foreground">
          {paper.journal ? (
            <span className="font-medium text-foreground/80">{paper.journal}</span>
          ) : null}
          <span>{formatDate(paper.publication_date)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MetaLink href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`} label="PubMed" />
          {paper.doi ? <MetaLink href={`https://doi.org/${paper.doi}`} label={paper.doi} /> : null}
        </div>
        {paper.authors.length > 0 ? (
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            {paper.authors.join(", ")}
          </p>
        ) : null}
      </section>

      {!matrixPaper ? (
        <Card className="border-dashed">
          <CardContent className="px-4 py-4">
            <p className="text-[0.8125rem] text-muted-foreground">
              This paper is not in the review yet.
            </p>
            <Button className="mt-2.5" size="sm" onClick={() => void addPaperToReview(paper)}>
              <Plus className="size-3.5" aria-hidden="true" />
              Add to review
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <ScreeningCard matrixPaper={matrixPaper} />
          <NotesCard matrixPaper={matrixPaper} />
          <EvidenceCard matrixPaper={matrixPaper} />
        </>
      )}

      <section className="space-y-2 border-t border-border/60 pt-4">
        <h4 className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Abstract
        </h4>
        <p className="mt-1 whitespace-pre-line text-[0.8125rem] leading-relaxed text-foreground/90">
          {paper.abstract ?? "No abstract available."}
        </p>
      </section>

      <div className="flex justify-center">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground">
          Close
        </Button>
      </div>
    </div>
  );
}

export function PaperDetail() {
  const { detailPaper, closePaper, matrix } = useWorkspace();

  if (!detailPaper) return null;

  const matrixPaper = matrix?.papers.find((paper) => paper.pmid === detailPaper.pmid) ?? null;

  return (
    <Drawer
      open
      onClose={closePaper}
      title={
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.6875rem] font-semibold text-muted-foreground">
            PMID {detailPaper.pmid}
          </span>
          {matrixPaper ? <StatusBadge status={matrixPaper.status} /> : null}
        </div>
      }
    >
      <DetailBody
        key={detailPaper.pmid}
        paper={detailPaper}
        matrixPaper={matrixPaper}
        onClose={closePaper}
      />
    </Drawer>
  );
}
