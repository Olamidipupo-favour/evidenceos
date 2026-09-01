"use client";

import { useState } from "react";

import {
  Bot,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  ListChecks,
  Plus,
  Radio,
  Search,
  StickyNote,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import type { ActivityEntry } from "@/lib/types";
import { formatActivityTime } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 15;

const KIND_ICONS: Record<ActivityEntry["kind"], LucideIcon> = {
  search: Search,
  add: Plus,
  screen: ListChecks,
  note: StickyNote,
  remove: Trash2,
  evidence: FlaskConical,
  review: Radio,
  tool: Bot,
};

const TONE_CLASS: Record<ActivityEntry["tone"], string> = {
  neutral: "bg-muted-foreground",
  accent: "bg-signal",
  positive: "bg-status-included",
  warning: "bg-status-excluded",
};

export function AgentActivity({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activity } = useWorkspace();
  const [page, setPage] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);

  // Newest-first: page 1 shows the most recent entries. Reset to page 1 when
  // the drawer is reopened so it always starts at the live end of the feed.
  if (open && !prevOpen) {
    setPrevOpen(open);
    setPage(0);
  } else if (prevOpen !== open) {
    setPrevOpen(open);
  }

  const pageCount = Math.max(1, Math.ceil(activity.length / PAGE_SIZE));
  const pageIndex = Math.min(page, pageCount - 1);
  const pageEntries = activity.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <Radio className="size-4 text-signal" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">Activity</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
            {activity.length}
          </span>
        </div>
      }
    >
      <div className="p-5">
        {activity.length === 0 ? (
          <EmptyState
            compact
            icon={Radio}
            title="Nothing logged yet"
            description="Actions across the workspace appear here in real time — searches, adds, screening, notes, evidence extractions, and WebMCP agent tool calls."
          />
        ) : (
          <>
            <ul className="relative space-y-1">
              {pageEntries.map((entry, index) => {
                const Icon = KIND_ICONS[entry.kind];
                return (
                  <li key={entry.id} className="relative flex gap-3 pb-1">
                    {index < pageEntries.length - 1 ? (
                      <span
                        aria-hidden="true"
                        className="absolute top-7 left-[13px] h-full w-px bg-border/70"
                      />
                    ) : null}
                    <span
                      className={cn(
                        "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card",
                        TONE_CLASS[entry.tone],
                        entry.tone === "neutral" && "text-muted-foreground",
                        entry.tone === "accent" && "text-signal",
                        entry.tone === "positive" && "text-status-included",
                        entry.tone === "warning" && "text-status-excluded",
                      )}
                    >
                      <Icon className="size-3.5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 pb-3">
                      <p className="text-[0.8125rem] leading-relaxed text-foreground/90">
                        {entry.message}
                      </p>
                      <time className="text-[0.6875rem] text-muted-foreground">
                        {formatActivityTime(entry.at)}
                      </time>
                    </div>
                  </li>
                );
              })}
            </ul>
            {pageCount > 1 ? (
              <div className="mt-1 flex items-center justify-between border-t border-border/60 pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pageIndex <= 0}
                  onClick={() => setPage(pageIndex - 1)}
                >
                  <ChevronLeft className="size-3.5" aria-hidden="true" />
                  Previous
                </Button>
                <span className="text-[0.6875rem] text-muted-foreground">
                  Page {pageIndex + 1} of {pageCount}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pageIndex >= pageCount - 1}
                  onClick={() => setPage(pageIndex + 1)}
                >
                  Next
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Drawer>
  );
}
