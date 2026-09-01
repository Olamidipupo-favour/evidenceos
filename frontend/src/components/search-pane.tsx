"use client";

import { useState, type FormEvent } from "react";

import { ChevronLeft, ChevronRight, Search, SearchX, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PaperCard } from "@/components/paper-card";
import { exampleQueries } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace";

const PAGE_SIZE = 25;

function ResultSkeleton() {
  return (
    <div className="space-y-4 px-5 py-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function SearchPane() {
  const {
    query,
    searchResults,
    searchTotal,
    searchPage,
    searchLoading,
    searchError,
    runSearch,
    clearSearch,
    goToPage,
    matrix,
    addPaperToReview,
    openPaper,
  } = useWorkspace();
  const [text, setText] = useState(query);
  const [prevQuery, setPrevQuery] = useState(query);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch(text);
  };

  // Keep the box in sync with the active query (example chips, agent-driven
  // searches, workspace switches). Reset during render so typing is never
  // clobbered by an effect.
  if (query !== prevQuery) {
    setPrevQuery(query);
    setText(query);
  }

  const handleClear = () => {
    clearSearch();
    setText("");
  };

  const maxPages = Math.max(1, Math.ceil(searchTotal / PAGE_SIZE));
  const hasSearched = query.length > 0 || searchResults.length > 0;
  const inReviewPmids = new Set(matrix?.papers.map((paper) => paper.pmid) ?? []);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">
          <span className="flex items-center gap-2">
            <Search className="size-4 text-muted-foreground" aria-hidden="true" />
            Literature search
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <form onSubmit={submit} className="flex gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              role="searchbox"
              aria-label="Search PubMed"
              className="pl-9"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Search PubMed, e.g. metformin type 2 diabetes"
            />
          </div>
          <Button type="submit" disabled={!text.trim() || searchLoading}>
            {searchLoading ? "Searching…" : "Search"}
          </Button>
          {(hasSearched || text) && !searchLoading ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={handleClear}
              aria-label="Clear search results"
              title="Cancel the current query and clear all results"
            >
              <X className="size-3.5" aria-hidden="true" />
              Clear
            </Button>
          ) : null}
        </form>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            Try
          </span>
          {exampleQueries().map((example) => (
            <Button
              key={example}
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[0.6875rem] text-muted-foreground"
              onClick={() => {
                setText(example);
                void runSearch(example);
              }}
            >
              {example}
            </Button>
          ))}
        </div>
      </CardContent>

      <div className="border-t border-border/60 text-[0.6875rem] text-muted-foreground">
        {searchLoading ? (
          <ResultSkeleton />
        ) : searchError ? (
          <div className="p-5">
            <ErrorState compact message={searchError} onRetry={() => void runSearch(query)} />
          </div>
        ) : searchResults.length === 0 ? (
          <div className="p-5">
            {hasSearched ? (
              <EmptyState
                compact
                icon={SearchX}
                title="No results"
                description="PubMed returned nothing for that query. Try broader terms or a different drug class."
              />
            ) : (
              <EmptyState
                compact
                icon={Search}
                title="Find primary studies"
                description="Search PubMed to start your screening queue. Papers you add appear in the review workspace."
              />
            )}
          </div>
        ) : (
          <>
            <div className="px-5 pt-3">
              <span aria-hidden="true">
                {searchTotal.toLocaleString()} result{searchTotal === 1 ? "" : "s"} · page{" "}
                {searchPage} of {maxPages}
              </span>
            </div>
            <div className="mt-2">
              {searchResults.map((paper) => (
                <PaperCard
                  key={paper.pmid}
                  paper={paper}
                  inReview={inReviewPmids.has(paper.pmid)}
                  onAdd={() => void addPaperToReview(paper)}
                  onOpen={() => openPaper(paper)}
                />
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-border/60 px-5 py-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={searchPage <= 1}
                onClick={() => void goToPage(searchPage - 1)}
              >
                <ChevronLeft className="size-3.5" aria-hidden="true" />
                Previous
              </Button>
              <span className="text-[0.6875rem] text-muted-foreground">
                Page {searchPage} of {maxPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={searchPage >= maxPages}
                onClick={() => void goToPage(searchPage + 1)}
              >
                Next
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
