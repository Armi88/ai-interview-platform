import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ComparisonTable from "./ComparisonTable";
import type { SkillComparison } from "@/types";

// Shape exactly as FitGap::Engine serializes it.
const apiRow = (o: Partial<SkillComparison>): SkillComparison => ({
  skill_label: "Ruby",
  skill_id: "ruby",
  required_level: 3,
  expected_level: 3,
  candidate_level: 3,
  ai_level: 3,
  is_override: false,
  result: "match",
  delta: 0,
  confidence: "high",
  ...o,
});

describe("<ComparisonTable />", () => {
  it("shows the REQUIRED level from the API payload (regression: column used to render blank)", () => {
    render(<ComparisonTable comparisons={[apiRow({ required_level: 4, candidate_level: 2, result: "gap", delta: -2 })]} />);
    const table = screen.getByRole("table");
    const row = within(table).getByRole("row", { name: /Ruby/ });
    expect(within(row).getByText("L4")).toBeInTheDocument();
    expect(within(row).getByText("L2")).toBeInTheDocument();
    expect(within(row).getByText(/Gap/)).toBeInTheDocument();
  });

  it("marks assessor overrides (regression: is_override was never sent so the marker never showed)", () => {
    render(<ComparisonTable comparisons={[apiRow({ is_override: true, ai_level: 2, candidate_level: 4, result: "exceed", delta: 1 })]} />);
    expect(screen.getAllByText(/adjusted by assessor/i).length).toBeGreaterThan(0);
  });

  it("labels a skill without a candidate level as Not assessed, not as a gap", () => {
    render(<ComparisonTable comparisons={[apiRow({ candidate_level: null, ai_level: null, result: "not_assessed", delta: null })]} />);
    const row = within(screen.getByRole("table")).getByRole("row", { name: /Ruby/ });
    expect(within(row).getAllByText(/Not assessed/).length).toBeGreaterThan(0);
    expect(within(row).queryByText(/^Gap/)).not.toBeInTheDocument();
  });

  it("still renders reports saved with the legacy expected_level field", () => {
    render(<ComparisonTable comparisons={[apiRow({ required_level: undefined, expected_level: 5 })]} />);
    expect(within(screen.getByRole("table")).getByText("L5")).toBeInTheDocument();
  });

  it("shows an explanatory empty state for a vacancy with no skills", () => {
    render(<ComparisonTable comparisons={[]} />);
    expect(screen.getByText(/no required skills yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("keeps very long skill labels inside the layout", () => {
    const long = "A".repeat(300);
    render(<ComparisonTable comparisons={[apiRow({ skill_label: long })]} />);
    expect(within(screen.getByRole("table")).getByText(long)).toHaveClass("break-words");
  });
});
