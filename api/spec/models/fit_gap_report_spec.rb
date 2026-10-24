# frozen_string_literal: true

require 'rails_helper'

RSpec.describe FitGapReport do
  it 'accepts an empty comparison list (vacancy without required skills)' do
    report = described_class.new(skill_comparisons: [])
    report.valid?

    expect(report.errors[:skill_comparisons]).to be_empty
  end

  it 'rejects a nil comparison list' do
    report = described_class.new(skill_comparisons: nil)
    report.valid?

    expect(report.errors[:skill_comparisons]).to be_present
  end

  it 'rejects an unknown narrative source' do
    report = described_class.new(skill_comparisons: [], narrative_source: 'guess')
    report.valid?

    expect(report.errors[:narrative_source]).to be_present
  end
end
