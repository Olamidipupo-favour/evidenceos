"use client";

import { useState, type FormEvent } from "react";

import { ArrowRight, FileSearch, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/lib/workspace";

const EXAMPLE = {
  title: "SGLT2 inhibitors vs. cardiovascular outcomes",
  question:
    "In adults with type 2 diabetes, do SGLT2 inhibitors reduce the incidence of major adverse cardiovascular events compared with placebo or standard care?",
};

export function ReviewCreate() {
  const { createReview } = useWorkspace();
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const ok = await createReview(title.trim(), question.trim() || null);
    setBusy(false);
    if (!ok) return;
    setTitle("");
    setQuestion("");
  };

  return (
    <section className="flex items-center justify-center px-4">
      <Card className="w-full max-w-xl border-dashed">
        <CardContent className="px-6 py-10 sm:px-10">
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-signal-soft text-signal">
              <FileSearch className="size-6" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight">Start a review.</h2>
              <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
                Search PubMed, screen the primary studies, organize them into a workspace, and
                extract structured evidence into a synthesis matrix.
              </p>
            </div>

            <form onSubmit={submit} className="w-full space-y-3 text-left">
              <div className="space-y-1.5">
                <label htmlFor="review-title" className="text-xs font-medium text-muted-foreground">
                  Review title
                </label>
                <Input
                  id="review-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. SGLT2 inhibitors and cardiovascular outcomes"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="review-question"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Research question{" "}
                  <span className="font-normal text-muted-foreground/70">(optional)</span>
                </label>
                <Textarea
                  id="review-question"
                  rows={3}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="In adults with type 2 diabetes, do SGLT2 inhibitors reduce major adverse cardiovascular events compared with standard care?"
                />
              </div>
              <Button type="submit" className="w-full" disabled={!title.trim() || busy}>
                {busy ? "Creating…" : "Create workspace"}
                {!busy && <ArrowRight className="size-4" aria-hidden="true" />}
              </Button>
            </form>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                Try an example
              </span>
              <Button
                type="button"
                variant="soft"
                size="sm"
                onClick={() => {
                  setTitle(EXAMPLE.title);
                  setQuestion(EXAMPLE.question);
                }}
              >
                <Sparkles className="size-3.5" aria-hidden="true" />
                SGLT2 &amp; MACE
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
