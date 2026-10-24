# frozen_string_literal: true

# Adds a machine-readable summary and the provenance of the narrative to
# fit_gap_reports. Both columns have defaults, so existing rows stay valid and
# the migration is fully reversible.
class AddSummaryAndNarrativeSourceToFitGapReports < ActiveRecord::Migration[7.0]
  def change
    add_column :fit_gap_reports, :summary, :jsonb, null: false, default: {}
    add_column :fit_gap_reports, :narrative_source, :string, limit: 20, null: false, default: 'ai'
    add_check_constraint :fit_gap_reports,
                         "narrative_source IN ('ai', 'fallback')",
                         name: 'chk_fit_gap_reports_narrative_source'
  end
end
