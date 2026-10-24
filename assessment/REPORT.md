# Fit/Gap Report: making it trustworthy for the people it decides about

> DRAFT written from code reading. Items marked **[TO VERIFY]** must be confirmed by running the app
> (screenshots, DB inspection, video) before submitting.

## Step 2: Context (summary)
- **Users**: assessors (review AI ratings, override), recruiters/hiring managers (read the Fit/Gap report to decide who moves on).
- **Candidates**: assessed by an AI interview without choosing it. A wrong or misleading report changes a real person's year.
  UU PDP: transcripts/ratings are personal data → least privilege (tenant isolation), no personal data in logs, explainability (show *why* a level was given, and when a human changed it).
- **Where the leverage is**: the Fit/Gap report is the single artefact that turns a 30-min interview into a hiring decision. If it is blank, misleading or wrong, the interview was wasted.

## Step 3: Findings (severity-ranked)
| # | Sev | Type | Finding | Impact |
|---|-----|------|---------|--------|
| 1 | P0 | Defect (api) | `PortfoliosController` / `PortfolioSkillsController` looked up `Portfolio`/`PortfolioSkill` with an unscoped `find`; `Portfolio` has no tenant column | Any assessor of tenant A can read, regenerate or **override ratings** of tenant B's candidates by iterating ids (UU PDP breach + tampered hiring data) |
| 2 | P1 | Defect (seam) | API sends `expected_level` and no `is_override`; UI reads `required_level` and `is_override` | "Required" column renders blank for every row; the ✏ override marker never appears, so humans can't see which ratings were changed |
| 3 | P1 | Defect (web) | `fetchReport` POSTs `triggerFitGap` on every 404, and it is also the 5 s polling callback | While generating, the client re-enqueues a Gemini job every 5 s (cost + duplicate jobs); non-404 errors are swallowed → blank page forever |
| 4 | P1 | Defect (api) | Override and regenerate `destroy` the report *before* the job runs | If the job fails/times out the assessor loses the report; page shows 404 → re-trigger loop |
| 5 | P1 | Defect (api) | `validates :skill_comparisons, presence: true` rejects `[]` | A vacancy with no skills makes the worker raise (retry ×2) and no report ever exists |
| 6 | P2 | Missing spec | Nothing defines how "not assessed" should be read; UI counts only match/gap/exceed and the LLM prompt lumps it in | A candidate never asked about SQL looks the same as one who failed SQL. Recruiters read missing evidence as weakness |
| 7 | P2 | Defect (api) | Model output trusted blindly (arrays, non-strings, unbounded length) | One bad response → 500/garbage text stored and shown |
| 8 | P2 | Defect | Duplicate jobs race on `find_or_initialize_by` → `RecordNotUnique` | Spurious job failures |
| 9 | P3 | Missing spec | Fallback narrative is indistinguishable from AI text | Reader can't tell they are reading boilerplate |
| 10 | P3 | UX | 2xl-wide table, no mobile layout, no loading/error/empty states | Unusable on phone; silent failures |

**Constraint signals to escalate to a Tech Lead**
1. `Portfolio` lacks `tenant_id`; tenancy is inherited via `sessions`. I used a sub-select scope; a denormalised `tenant_id` + DB-level RLS would be sturdier.
2. Export/PDF (`Exports::PdfGenerator`) and the sessions controller were **not** audited for the same scoping gap. **[TO VERIFY]**
3. No product decision exists on whether AI levels may auto-reject candidates. I deliberately did *not* add a single "fit score".
4. Retention/consent for transcripts under UU PDP is unspecified.

## Step 4: Options & trade-offs
| | A. Patch the seam only (rename fields) | **B. Chosen:** engine-owned contract + coverage + safe regeneration | C. Full redesign (scoring model, weights, DB tenant column) |
|---|---|---|---|
| Impact | Fixes blank column | Fixes 1–10, adds coverage signal | Biggest, needs product input |
| Cost | ~1 h | ~1 day | weeks |
| Maintain | Leaves races and tenant hole | Pure functions + small hook, easily tested | New model to maintain |
| Failure modes | Same loops | Fallback narrative, polling timeout | Scope creep |
| Reversible | yes | yes (defaulted migration, additive API fields kept `expected_level`) | hard |

Why B: it closes a security hole and the user-visible defects within the existing architecture, and is reversible. It does not invent a scoring policy that product has not defined.

## Acceptance criteria (written before coding)
1. Another tenant's portfolio/skill id → 404; never data. **[API spec TO WRITE at controller level]**
2. Each comparison row has `required_level`, `candidate_level`, `is_override`, `result`; `expected_level` stays for old clients.
3. Skill with no portfolio entry → `not_assessed` (delta nil), never `gap`.
4. Summary reports coverage; "not assessed" is explained as *missing evidence*.
5. Vacancy with zero skills → report with `[]`, UI empty state, no model call.
6. Model failure / non-JSON / wrong types / huge text → fallback narrative, `narrative_source = 'fallback'`, UI says so.
7. Duplicate job → one row, no error.
8. Regenerate keeps the old report visible until `generated_at` changes; failures never delete data.
9. Client triggers generation once; polling stops after ~2 min with a retry button; errors are shown.
10. Layout works at 360 px; long labels wrap; loading, empty, error, timeout, regenerating states exist.
11. Migration is reversible and safe for existing rows (defaults).

## Step 5: Evidence
- Web: `cd web && npm test` → 21 tests (Vitest + Testing Library); `npx tsc --noEmit` clean.
- **Seeded fault** (`scratch/seeded-fault`): commit `d8cc0e1` breaks three behaviours (not_assessed counted as gap, poll re-triggers generation, required-level read) → **4 tests failed**; revert commit `dfbf0ba` → 21/21 pass. History preserved.
- API: RSpec specs for `FitGap::Engine` (levels, overrides, not_assessed, label matching, model failure, malformed output ×5, truncation, empty vacancy, duplicate-job retry), `FitGapReport` validation, `Coverage::StateEngine`.
  **[TO VERIFY] run `bundle exec rspec` locally and do an API seeded fault the same way.** They were syntax-checked only, because the authoring sandbox could not install gems.
- CI: `.github/workflows/ci.yml` (Postgres + Redis, rspec, web test + build).

### AI verification moment **[REPLACE WITH YOUR OWN EXPERIENCE]**
Candidate example from this work: the first idea for tenant scoping was `Portfolio.joins(:session)`, relying on `Session`'s `default_scope`
to filter. I was not sure default scopes are applied through joins, so I used an explicit `where(session_id: Session.select(:id))` sub-select
and should confirm it with a two-tenant request spec. Write your actual verification (e.g. the SQL printed in the console) here.

## Not done / honest limits
- Controller/request specs for the tenant isolation (acceptance criterion 1) are not written yet.
- Screenshots, video and live DB inspection are missing.
- `PortfolioPage`/OverridePanel were not changed.
