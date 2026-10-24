# frozen_string_literal: true

class FitGapReport < ApplicationRecord
  FIT_RESULTS       = %w[match gap exceed not_assessed].freeze
  NARRATIVE_SOURCES = %w[ai fallback].freeze

  belongs_to :portfolio
  belongs_to :vacancy

  # An empty array is a legitimate value (a vacancy with no required skills),
  # so we only reject nil. `presence: true` would reject [] and make the worker
  # fail forever for such vacancies.
  validates :skill_comparisons, exclusion: { in: [nil], message: "can't be nil" }
  validates :narrative_source, inclusion: { in: NARRATIVE_SOURCES }
end
