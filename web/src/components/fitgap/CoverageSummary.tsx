import { AlertTriangle } from "lucide-react";
import { resolveSummary } from "@/lib/fitgap";
import type { FitGapReport } from "@/types";

/**
 * Tells the reader how much of the required skill set the interview actually
 * observed. "Not assessed" is missing evidence, not a weakness, and a hiring
 * decision should not be made on a half-observed candidate without knowing it.
 */
export default function CoverageSummary({ report }: { report: FitGapReport }) {
  const s = resolveSummary(report);
  if (s.total === 0 || s.coverage_pct == null) return null;

  const incomplete = s.not_assessed > 0;
  return (
    <div
      className={`rounded-lg border p-4 space-y-2 ${incomplete ? "border-amber-200 bg-amber-50" : "bg-muted/30"}`}
      role="group"
      aria-label="Assessment coverage"
    >
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Assessment coverage</span>
        <span className="tabular-nums">{s.assessed} of {s.total} skills ({s.coverage_pct}%)</span>
      </div>
      <div
        className="h-2 rounded bg-neutral-200 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={s.coverage_pct}
      >
        <div className="h-full bg-teal-600" style={{ width: `${s.coverage_pct}%` }} />
      </div>
      {incomplete && (
        <p className="flex items-start gap-1.5 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          {s.not_assessed} required skill{s.not_assessed === 1 ? " was" : "s were"} not covered in the interview.
          That is missing evidence, not a low rating. Consider a follow-up before deciding.
        </p>
      )}
    </div>
  );
}
