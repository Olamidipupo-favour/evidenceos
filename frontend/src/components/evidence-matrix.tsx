"use client";

import { LayoutGrid } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { ConfidenceBadge, StatusBadge } from "@/components/status-badge";
import type { ReviewMatrix } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

function Dash({ value }: { value: string | number | null | undefined }) {
  return <span className="text-muted-foreground/60">{value ? String(value) : "—"}</span>;
}

function MatrixTable({
  matrix,
  onOpenPaper,
}: {
  matrix: ReviewMatrix;
  onOpenPaper: (paper: ReviewMatrix["papers"][number]) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-left text-[0.8125rem]">
        <thead>
          <tr className="border-b border-border/60 text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            <th scope="col" className="px-5 py-2.5 font-medium">
              Paper
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Screening
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Population
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Intervention
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Outcome
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Key finding
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Sample
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Confidence
            </th>
          </tr>
        </thead>
        <tbody>
          {matrix.papers.map((paper) => {
            const extraction = paper.extractions[0];
            return (
              <tr
                key={paper.id}
                className="group border-b border-border/40 align-top last:border-0 hover:bg-muted/30"
              >
                <td className="max-w-[16rem] px-5 py-3">
                  <button
                    type="button"
                    onClick={() => onOpenPaper(paper)}
                    className="line-clamp-2 text-left text-sm font-medium leading-snug tracking-tight text-foreground group-hover:text-signal focus-visible:outline-none"
                  >
                    {paper.title}
                  </button>
                  <p className="mt-1 text-[0.6875rem] text-muted-foreground">PMID {paper.pmid}</p>
                </td>
                <td className="px-3 py-3">
                  <StatusBadge status={paper.status} />
                </td>
                <td className="max-w-[11rem] px-3 py-3 leading-snug text-muted-foreground">
                  <Dash value={extraction?.population} />
                </td>
                <td className="max-w-[11rem] px-3 py-3 leading-snug text-muted-foreground">
                  <Dash value={extraction?.intervention} />
                </td>
                <td className="max-w-[11rem] px-3 py-3 leading-snug text-muted-foreground">
                  <Dash value={extraction?.outcome} />
                </td>
                <td className="max-w-[14rem] px-3 py-3 leading-snug text-muted-foreground">
                  <Dash value={extraction?.key_finding} />
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  <Dash value={extraction?.sample_size} />
                </td>
                <td className="px-3 py-3">
                  {extraction?.confidence ? (
                    <ConfidenceBadge confidence={extraction.confidence} />
                  ) : (
                    <span className="text-muted-foreground/60">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function EvidenceMatrix() {
  const { matrix, matrixLoading, matrixError, refreshMatrix, openPaper } = useWorkspace();

  const renderBody = () => {
    if (matrixLoading && !matrix)
      return (
        <CardContent className="space-y-3 p-5">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </CardContent>
      );
    if (matrixError)
      return (
        <CardContent className="p-5">
          <ErrorState compact message={matrixError} onRetry={() => void refreshMatrix()} />
        </CardContent>
      );
    if (!matrix || matrix.total_papers === 0)
      return (
        <CardContent className="p-5">
          <EmptyState
            compact
            icon={LayoutGrid}
            title="No evidence yet"
            description="Extract findings from included papers and they will be synthesised here."
          />
        </CardContent>
      );
    return <MatrixTable matrix={matrix} onOpenPaper={openPaper} />;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle as="h2">
            <span className="flex items-center gap-2">
              <LayoutGrid className="size-4 text-muted-foreground" aria-hidden="true" />
              Evidence matrix
            </span>
          </CardTitle>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
            {matrix ? `${matrix.included_papers} included of ${matrix.total_papers}` : "0 / 0"}
          </span>
        </div>
      </CardHeader>
      <div className="w-full border-t border-border/60">{renderBody()}</div>
    </Card>
  );
}
