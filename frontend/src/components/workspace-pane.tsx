"use client";

import { Inbox, Layers, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, SCREENING_LABELS } from "@/components/status-badge";
import type { ScreeningStatus } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS: ScreeningStatus[] = ["pending", "screened", "included", "excluded"];

function ListSkeleton() {
  return (
    <div className="space-y-5 px-5 py-4">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function WorkspacePane() {
  const {
    activeReview,
    matrix,
    matrixLoading,
    matrixError,
    refreshMatrix,
    setScreening,
    removePaper,
    openPaper,
  } = useWorkspace();

  if (!activeReview) {
    return (
      <Card>
        <CardContent className="p-5">
          <EmptyState
            compact
            icon={Layers}
            title="Review workspace"
            description="Create a review to start collecting papers. Your screening queue and notes live here."
          />
        </CardContent>
      </Card>
    );
  }

  const included = matrix?.papers.filter((paper) => paper.status === "included").length ?? 0;
  const total = matrix?.total_papers ?? 0;
  const progress = total > 0 ? Math.round((included / total) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle as="h2">
            <span className="flex items-center gap-2">
              <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
              Review workspace
            </span>
          </CardTitle>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
            {included}/{total}
          </span>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-[0.6875rem] text-muted-foreground">
            <span className="truncate font-medium text-foreground/80">{activeReview.title}</span>
            <span>
              {total} paper{total === 1 ? "" : "s"} · {included} included
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-signal transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </CardHeader>

      {matrixLoading && !matrix ? (
        <CardContent>
          <ListSkeleton />
        </CardContent>
      ) : matrixError ? (
        <CardContent className="p-5">
          <ErrorState compact message={matrixError} onRetry={() => void refreshMatrix()} />
        </CardContent>
      ) : total === 0 ? (
        <CardContent className="p-5">
          <EmptyState
            compact
            icon={Inbox}
            title="No papers yet"
            description="Run a search and add papers here. Screen them as you go."
          />
        </CardContent>
      ) : (
        <div className="border-t border-border/60">
          {matrix?.papers.map((paper) => (
            <article key={paper.id} className="border-b border-border/60 px-5 py-3 last:border-0">
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => openPaper(paper)}
                  aria-label={`Open details for ${paper.title}`}
                  className="min-w-0 text-left focus-visible:outline-none"
                >
                  <h3 className="line-clamp-2 text-sm font-medium leading-snug tracking-tight text-foreground hover:text-signal">
                    {paper.title}
                  </h3>
                  <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                    {paper.journal ? `${paper.journal} · ` : ""}
                    {formatDate(paper.publication_date)} · PMID {paper.pmid}
                  </p>
                </button>
                <StatusBadge status={paper.status} />
              </div>

              <div className="mt-2.5 flex items-center gap-2">
                <select
                  aria-label={`Screening status for ${paper.title}`}
                  value={paper.status}
                  onChange={(event) =>
                    void setScreening(paper.id, event.target.value as ScreeningStatus)
                  }
                  className={cn(
                    "h-7 rounded-md border border-input bg-card px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
                    paper.status === "included" && "text-status-included",
                    paper.status === "excluded" && "text-status-excluded",
                  )}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {SCREENING_LABELS[status]}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openPaper(paper)}
                  title="Read and annotate this paper"
                >
                  Notes
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => void removePaper(paper.id)}
                  title="Remove from review"
                  aria-label={`Remove ${paper.title} from review`}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}
