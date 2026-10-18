import { type Eligibility, ELIGIBILITY_LABELS, HIGH_FIT_SCORE } from "@ve/core";

const STYLES: Record<Eligibility, string> = {
  eligible: "bg-ok-soft text-ok",
  needs_check: "bg-warn-soft text-warn",
  not_eligible: "bg-bad-soft text-bad",
};

export function EligibilityPill({ verdict }: { verdict: Eligibility | null }) {
  if (!verdict) return <span className="text-ve-muted">Not scored</span>;
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STYLES[verdict]}`}>
      {ELIGIBILITY_LABELS[verdict]}
    </span>
  );
}

/** The fit score as a number in a box, with its scale spelled out for screen readers. */
export function FitBadge({ score, size = "md" }: { score: number | null; size?: "md" | "lg" }) {
  if (score === null) return <span className="text-ve-muted">–</span>;
  const strong = score >= HIGH_FIT_SCORE;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-bold ${
        size === "lg" ? "h-16 w-16 text-3xl" : "h-9 w-11 text-lg"
      } ${strong ? "bg-ve-yellow text-ve-on-yellow" : "border border-ve-line bg-white text-ve-charcoal"}`}
    >
      {score}
      <span className="sr-only"> out of 100</span>
    </span>
  );
}
