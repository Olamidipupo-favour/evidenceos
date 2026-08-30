"use client";

import { useState } from "react";

import { FileSearch, PanelRight } from "lucide-react";

import { AgentActivity } from "@/components/agent-activity";
import { ApiStatusPill } from "@/components/api-status";
import { Button } from "@/components/ui/button";
import { EvidenceMatrix } from "@/components/evidence-matrix";
import { PaperDetail } from "@/components/paper-detail";
import { QuestionPane } from "@/components/question-pane";
import { ReviewCreate } from "@/components/review-create";
import { SearchPane } from "@/components/search-pane";
import { Stepper } from "@/components/stepper";
import { WorkspacePane } from "@/components/workspace-pane";
import { WorkspaceProvider, useWorkspace } from "@/lib/workspace";

function Shell() {
  const { apiStatus, reviews, reach } = useWorkspace();
  const [activityOpen, setActivityOpen] = useState(false);

  const hasReview = reviews.length > 0;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between gap-3 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-signal text-white">
              <FileSearch className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="text-sm font-semibold tracking-tight">EvidenceOS</p>
              <p className="hidden truncate text-[0.6875rem] text-muted-foreground sm:block">
                Clinical evidence workspace
              </p>
            </div>
          </div>

          <div className="hidden md:block">
            <Stepper reach={reach} />
          </div>

          <div className="flex items-center gap-2">
            <ApiStatusPill status={apiStatus} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActivityOpen((open) => !open)}
              aria-expanded={activityOpen}
              aria-label="Toggle agent activity panel"
              className={activityOpen ? "text-signal" : ""}
            >
              <PanelRight className="size-3.5" aria-hidden="true" />
              Activity
            </Button>
          </div>
        </div>
        <div className="border-t px-4 py-1.5 md:hidden">
          <Stepper reach={reach} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-6">
        {!hasReview ? (
          <>
            <div className="mb-10">
              <ReviewCreate />
            </div>
            <EvidenceMatrix />
          </>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-6">
              <QuestionPane />
              <SearchPane />
            </div>
            <div className="min-w-0">
              <WorkspacePane />
            </div>
            <div className="lg:col-span-2">
              <EvidenceMatrix />
            </div>
          </div>
        )}
      </main>

      <PaperDetail />
      <AgentActivity open={activityOpen} onClose={() => setActivityOpen(false)} />
    </div>
  );
}

export function App() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}
