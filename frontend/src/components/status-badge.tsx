import type { Confidence, ScreeningStatus } from "@/lib/types";

import { Badge } from "@/components/ui/badge";

export const SCREENING_LABELS: Record<ScreeningStatus, string> = {
  pending: "Pending",
  screened: "Screened",
  included: "Included",
  excluded: "Excluded",
};

const SCREENING_VARIANTS: Record<
  ScreeningStatus,
  "pending" | "screened" | "included" | "excluded"
> = {
  pending: "pending",
  screened: "screened",
  included: "included",
  excluded: "excluded",
};

export function StatusBadge({ status }: { status: ScreeningStatus }) {
  return <Badge variant={SCREENING_VARIANTS[status]}>{SCREENING_LABELS[status]}</Badge>;
}

const CONFIDENCE_VARIANTS: Record<Confidence, "pending" | "screened" | "included"> = {
  low: "pending",
  medium: "screened",
  high: "included",
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <Badge variant={CONFIDENCE_VARIANTS[confidence]}>
      {confidence.charAt(0).toUpperCase() + confidence.slice(1)}
    </Badge>
  );
}
