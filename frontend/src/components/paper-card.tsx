"use client";

import { Plus, Check, ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LiteraturePaper } from "@/lib/types";
import { formatDate } from "@/lib/format";

interface PaperCardProps {
  paper: LiteraturePaper;
  inReview: boolean;
  onAdd: () => void;
  onOpen: () => void;
}

function authorList(authors: string[]): string {
  if (authors.length === 0) return "";
  const shown = authors.slice(0, 3).join(", ");
  return authors.length > 3 ? `${shown} et al.` : shown;
}

export function PaperCard({ paper, inReview, onAdd, onOpen }: PaperCardProps) {
  return (
    <article className="group flex flex-col gap-3 border-b border-border/60 px-5 py-4 transition-colors last:border-0 hover:bg-muted/30 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full text-left focus-visible:outline-none"
          aria-label={`View details for paper ${paper.title}`}
        >
          <h3 className="line-clamp-2 text-sm font-medium leading-snug tracking-tight text-foreground transition-colors group-hover:text-signal">
            {paper.title}
          </h3>
        </button>
        {paper.abstract ? (
          <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-relaxed text-muted-foreground">
            {paper.abstract}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-muted-foreground">
          {paper.journal ? (
            <span className="font-medium text-foreground/80">{paper.journal}</span>
          ) : null}
          <span>{formatDate(paper.publication_date)}</span>
          <span>PMID {paper.pmid}</span>
          {paper.doi ? (
            <Badge variant="soft" className="max-w-[13rem]">
              <span className="truncate">doi:{paper.doi}</span>
            </Badge>
          ) : null}
        </div>
        {paper.authors.length > 0 ? (
          <p className="mt-1 truncate text-[0.6875rem] text-muted-foreground/80">
            {authorList(paper.authors)}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
        {inReview ? (
          <Badge variant="included">
            <Check className="size-3" aria-hidden="true" />
            In review
          </Badge>
        ) : (
          <Button variant="soft" size="sm" onClick={onAdd}>
            <Plus className="size-3.5" aria-hidden="true" />
            Add to review
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onOpen}>
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
          Details
        </Button>
      </div>
    </article>
  );
}
