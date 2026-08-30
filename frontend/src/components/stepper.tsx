import { Check } from "lucide-react";

import type { WorkflowStage } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const STEPS: { label: WorkflowStage; hint: string }[] = [
  { label: "SEARCH", hint: "Find primary studies" },
  { label: "SELECT", hint: "Pick relevant papers" },
  { label: "ORGANIZE", hint: "Screen and annotate" },
  { label: "SYNTHESIZE", hint: "Extract evidence" },
];

export function Stepper({ reach }: { reach: WorkflowStage }) {
  const reached = STEPS.findIndex((step) => step.label === reach);
  const current = Math.max(0, reached);

  return (
    <nav aria-label="Workflow progress" className="flex items-center gap-1">
      {STEPS.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming";
        return (
          <div key={step.label} className="flex items-center">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-5 items-center justify-center rounded-full border text-[0.625rem] font-semibold",
                  state === "done" && "border-signal bg-signal text-white",
                  state === "current" && "border-signal text-signal ring-2 ring-ring/25",
                  state === "upcoming" && "border-border text-muted-foreground",
                )}
              >
                {state === "done" ? <Check className="size-3" strokeWidth={3} /> : index + 1}
              </span>
              <span
                className={cn(
                  "hidden text-[0.6875rem] font-medium tracking-wide md:block",
                  state === "current" ? "text-foreground" : "text-muted-foreground",
                )}
                title={step.hint}
              >
                {step.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className={cn("mx-1.5 h-px w-4", index < current ? "bg-signal" : "bg-border")}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
