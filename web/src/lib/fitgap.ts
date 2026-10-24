import { LEVEL_LABELS } from "@/utils/constants";
import type { FitGapReport, FitGapSummary, SkillComparison } from "@/types";

/** The API renamed expected_level -> required_level; accept both. */
export function requiredLevel(c: SkillComparison): number | null {
  return c.expected_level ?? null;
}

export function levelLabel(level: number | null | undefined): string {
  if (level == null) return "—";
  return LEVEL_LABELS[level] ?? "—";
}

/** Derive a summary client-side for reports that predate the summary column. */
export function summarizeComparisons(comparisons: SkillComparison[]): FitGapSummary {
  const count = (r: SkillComparison["result"]) => comparisons.filter((c) => c.result === r).length;
  const total = comparisons.length;
  const notAssessed = count("not_assessed");
  const assessed = total - notAssessed;
  return {
    total,
    assessed,
    match: count("match"),
    exceed: count("exceed"),
    gap: count("gap") + count("not_assessed"),
    not_assessed: notAssessed,
    coverage_pct: total === 0 ? null : Math.round((assessed * 100) / total),
  };
}

/** Prefer the server summary, fall back to computing it. */
export function resolveSummary(report: FitGapReport): FitGapSummary {
  const s = report.summary;
  if (s && typeof s.total === "number") return s as FitGapSummary;
  return summarizeComparisons(report.skill_comparisons ?? []);
}
