import { FIT_GAP_RESULT_LABELS, FIT_GAP_RESULT_CLASSES } from "@/utils/constants";
import { cn } from "@/lib/utils";
import { levelLabel, requiredLevel, summarizeComparisons } from "@/lib/fitgap";
import type { SkillComparison } from "@/types";

interface ComparisonTableProps {
  comparisons: SkillComparison[];
}

const ICONS: Record<SkillComparison["result"], string> = {
  match: "✓",
  exceed: "↑",
  gap: "↓",
  not_assessed: "–",
};

export function ResultBadge({ comparison }: { comparison: SkillComparison }) {
  const { result, delta } = comparison;
  const suffix = delta ? ` ${delta > 0 ? "+" : "−"}${Math.abs(delta)}` : "";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium px-2 py-0.5 rounded",
        FIT_GAP_RESULT_CLASSES[result]
      )}
    >
      <span aria-hidden="true">{ICONS[result]}</span>
      {FIT_GAP_RESULT_LABELS[result]}
      {result !== "match" && result !== "not_assessed" && suffix}
    </span>
  );
}

function CandidateLevel({ c }: { c: SkillComparison }) {
  if (c.candidate_level == null) {
    return (
      <span className="text-muted-foreground" title="The interview did not produce evidence for this skill">
        Not assessed
      </span>
    );
  }
  return (
    <span>
      {levelLabel(c.candidate_level)}
      {c.is_override && (
        <span
          className="ml-1 text-xs text-muted-foreground"
          title={`Adjusted by assessor (AI rated ${levelLabel(c.ai_level)})`}
        >
          ✏ <span className="sr-only">adjusted by assessor</span>
        </span>
      )}
    </span>
  );
}

export default function ComparisonTable({ comparisons }: ComparisonTableProps) {
  if (comparisons.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        This vacancy has no required skills yet, so there is nothing to compare. Add skills to the vacancy and
        regenerate the report.
      </div>
    );
  }

  const s = summarizeComparisons(comparisons);

  return (
    <div className="space-y-3">
      {/* ≥ sm: table */}
      <div className="hidden sm:block overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th scope="col" className="text-left px-4 py-2.5 font-medium">Skill</th>
              <th scope="col" className="text-center px-4 py-2.5 font-medium">Required</th>
              <th scope="col" className="text-center px-4 py-2.5 font-medium">Candidate</th>
              <th scope="col" className="text-center px-4 py-2.5 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map((c, i) => (
              <tr key={`${c.skill_id ?? c.skill_label}-${i}`} className="border-b last:border-0">
                <th scope="row" className="px-4 py-2.5 text-left font-normal max-w-[16rem] break-words">
                  {c.skill_label}
                </th>
                <td className="px-4 py-2.5 text-center text-muted-foreground">{levelLabel(requiredLevel(c))}</td>
                <td className="px-4 py-2.5 text-center"><CandidateLevel c={c} /></td>
                <td className="px-4 py-2.5 text-center"><ResultBadge comparison={c} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* < sm: stacked cards */}
      <ul className="sm:hidden space-y-2" aria-label="Skill comparison">
        {comparisons.map((c, i) => (
          <li key={`${c.skill_id ?? c.skill_label}-${i}`} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium break-words min-w-0">{c.skill_label}</span>
              <ResultBadge comparison={c} />
            </div>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Required</dt>
                <dd>{levelLabel(requiredLevel(c))}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Candidate</dt>
                <dd><CandidateLevel c={c} /></dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Match: {s.match}</span>
        <span>Exceeds: {s.exceed}</span>
        <span>Gap: {s.gap}</span>
        {s.not_assessed > 0 && <span>Not assessed: {s.not_assessed}</span>}
        <span className="sm:ml-auto">✏ = assessor adjusted</span>
      </div>
    </div>
  );
}
