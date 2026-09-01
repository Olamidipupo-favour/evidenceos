"use client";

import { useState } from "react";

import { Check, FileQuestion, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/lib/workspace";

const NEW_WORKSPACE_VALUE = "__new_workspace__";

export function QuestionPane() {
  const {
    activeReview,
    activeReviewId,
    reviews,
    selectReview,
    deleteReview,
    creatingReview,
    startCreateReview,
    saveQuestion,
    questionDraft,
  } = useWorkspace();
  const [draft, setDraft] = useState(questionDraft);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loadedReviewId, setLoadedReviewId] = useState<string | null>(activeReviewId);

  const dirty = draft !== questionDraft;

  // Follow the active workspace: when the active review changes, load that
  // review's research question into the editor instead of keeping the old one.
  if (activeReviewId !== loadedReviewId) {
    setLoadedReviewId(activeReviewId);
    setDraft(questionDraft);
    setSaved(false);
  }

  const handleSwitch = (value: string) => {
    if (value === NEW_WORKSPACE_VALUE) {
      startCreateReview();
      return;
    }
    selectReview(value);
  };

  const handleSave = async () => {
    await saveQuestion(draft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      window.setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    setConfirmDelete(false);
    if (activeReviewId) await deleteReview(activeReviewId);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle as="h2">
            <span className="flex items-center gap-2">
              <FileQuestion className="size-4 text-muted-foreground" aria-hidden="true" />
              Research question
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <select
              aria-label="Switch review"
              value={creatingReview ? NEW_WORKSPACE_VALUE : (activeReviewId ?? "")}
              onChange={(event) => handleSwitch(event.target.value)}
              className="h-8 max-w-[11rem] rounded-lg border border-input bg-card px-2 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value={NEW_WORKSPACE_VALUE}>+ New workspace…</option>
              {reviews.map((review) => (
                <option key={review.id} value={review.id}>
                  {review.title}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              disabled={!activeReview}
              onClick={handleDelete}
              className={confirmDelete ? "text-destructive" : ""}
              title={confirmDelete ? "Click again to confirm" : "Delete this review"}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              {confirmDelete ? "Confirm" : null}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="In adults with type 2 diabetes, do SGLT2 inhibitors reduce major adverse cardiovascular events compared with standard care?"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.6875rem] text-muted-foreground">
            Shapes the literature search and the extraction prompts.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {saved ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-status-included">
                <Check className="size-3.5" aria-hidden="true" /> Saved
              </span>
            ) : null}
            <Button size="sm" onClick={handleSave} disabled={!dirty}>
              <Check className="size-3.5" aria-hidden="true" />
              Save
            </Button>
          </div>
        </div>
        <p className="flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-muted-foreground/80">
          <Plus className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>
            Choose “New workspace…” in the switch above to start another review; the active review
            is remembered between visits.
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
