# frozen_string_literal: true

class FitGapReport < ApplicationRecord
  FIT_RESULTS       = %w[match gap exceed not_assessed].freeze
  NARRATIVE_SOURCES = %w[ai fallback].freeze

  belongs_to :portfolio
  belongs_to :vacancy

  validates :narrative_source, inclusion: { in: NARRATIVE_SOURCES }
  validate :skill_comparisons_must_not_be_nil

  private

  # An empty array is a legitimate value (a vacancy with no required skills), so
  # only nil is rejected. Rails' exclusion/inclusion validators check array values
  # element by element, so `exclusion: { in: [nil] }` also rejected [].
  def skill_comparisons_must_not_be_nil
    errors.add(:skill_comparisons, "can't be nil") if skill_comparisons.nil?
  end
end
