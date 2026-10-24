import { describe, it, expect } from "vitest";
import { levelLabel, requiredLevel, resolveSummary, summarizeComparisons } from "./fitgap";
import type { FitGapReport, SkillComparison } from "@/types";

const c = (result: SkillComparison["result"], extra: Partial<SkillComparison> = {}): SkillComparison => ({
  skill_label: "X",
  result,
  ...extra,
});

describe("requiredLevel", () => {
  it("reads required_level", () => expect(requiredLevel(c("match", { required_level: 3 }))).toBe(3));
  it("falls back to legacy expected_level (reports saved before the rename)", () =>
    expect(requiredLevel(c("match", { expected_level: 4 }))).toBe(4));
  it("is null when neither is present instead of crashing", () => expect(requiredLevel(c("gap"))).toBeNull());
});

describe("levelLabel", () => {
  it("formats known levels", () => expect(levelLabel(3)).toBe("L3"));
  it("renders a dash for null, undefined and out-of-range values", () => {
    expect(levelLabel(null)).toBe("—");
    expect(levelLabel(undefined)).toBe("—");
    expect(levelLabel(99)).toBe("—");
  });
});

describe("summarizeComparisons", () => {
  it("never counts not_assessed as a gap and computes coverage", () => {
    const s = summarizeComparisons([c("match"), c("gap"), c("not_assessed"), c("not_assessed")]);
    expect(s).toMatchObject({ total: 4, assessed: 2, gap: 1, not_assessed: 2, coverage_pct: 50 });
  });
  it("returns null coverage for an empty list", () => {
    expect(summarizeComparisons([]).coverage_pct).toBeNull();
  });
});

describe("resolveSummary", () => {
  const base = { id: 1, portfolio_id: 1, vacancy_id: 1, culture_narrative: null, overall_narrative: null, generated_at: "t" };
  it("prefers the server summary", () => {
    const r: FitGapReport = { ...base, skill_comparisons: [], summary: { total: 7, assessed: 7, match: 7, exceed: 0, gap: 0, not_assessed: 0, coverage_pct: 100 } };
    expect(resolveSummary(r).total).toBe(7);
  });
  it("computes one for old reports whose summary column is the empty default {}", () => {
    const r: FitGapReport = { ...base, skill_comparisons: [c("match"), c("not_assessed")], summary: {} };
    expect(resolveSummary(r)).toMatchObject({ total: 2, not_assessed: 1, coverage_pct: 50 });
  });
});
