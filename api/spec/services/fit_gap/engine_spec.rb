# frozen_string_literal: true

require 'rails_helper'

# These specs exercise FitGap::Engine's decision logic with plain doubles so they
# need no fixtures: the engine's contract is "levels in, comparisons + narrative
# out", and the database is only the last step (persist).
RSpec.describe FitGap::Engine do
  Override = Struct.new(:override_level)
  PSkill   = Struct.new(:id, :skill_id, :skill_label, :ai_level, :ai_confidence, :assessor_override)
  VSkill   = Struct.new(:id, :skill_id, :skill_label, :expected_level)

  def build_engine(portfolio_skills:, vacancy_skills:, gemini:)
    portfolio = double('Portfolio', id: 1, portfolio_skills: double(includes: portfolio_skills))
    vacancy   = double('Vacancy',
                       id: 2, role_title: 'Backend Engineer',
                       culture_dimensions: 'Ownership', competency_expectations: nil,
                       vacancy_skills: double(order: vacancy_skills))
    described_class.new(portfolio: portfolio, vacancy: vacancy, gemini_client: gemini)
  end

  let(:report) { instance_double(FitGapReport, update!: true) }

  before do
    allow(FitGapReport).to receive(:find_or_initialize_by).and_return(report)
  end

  def saved_attrs
    attrs = nil
    allow(report).to receive(:update!) { |a| attrs = a }
    yield
    attrs
  end

  describe '.compare_levels' do
    it 'returns not_assessed with a nil delta when the candidate has no level' do
      expect(described_class.compare_levels(nil, 3)).to eq(result: 'not_assessed', delta: nil)
    end

    it 'classifies match, exceed and gap by the signed delta' do
      expect(described_class.compare_levels(3, 3)).to eq(result: 'match',  delta: 0)
      expect(described_class.compare_levels(5, 3)).to eq(result: 'exceed', delta: 2)
      expect(described_class.compare_levels(1, 3)).to eq(result: 'gap',    delta: -2)
    end
  end

  describe '.summarize' do
    it 'does not count not_assessed skills as gaps and reports coverage' do
      comparisons = [{ result: 'match' }, { result: 'gap' }, { result: 'not_assessed' }, { result: 'not_assessed' }]
      summary = described_class.summarize(comparisons)

      expect(summary).to include(total: 4, assessed: 2, gap: 1, match: 1, not_assessed: 2, coverage_pct: 50)
    end

    it 'returns a nil coverage for an empty comparison instead of dividing by zero' do
      expect(described_class.summarize([])).to include(total: 0, assessed: 0, coverage_pct: nil)
    end
  end

  describe '#call' do
    let(:ok_gemini) do
      double('Gemini', generate_content: { 'culture_narrative' => 'Culture ok.', 'overall_narrative' => 'Strong.' })
    end

    it 'applies assessor overrides and flags them with is_override' do
      engine = build_engine(
        portfolio_skills: [PSkill.new(10, 'ruby', 'Ruby', 2, 'high', Override.new(4))],
        vacancy_skills:   [VSkill.new(1, 'ruby', 'Ruby', 3)],
        gemini:           ok_gemini
      )
      attrs = saved_attrs { engine.call }
      row = attrs[:skill_comparisons].first

      expect(row).to include(candidate_level: 4, ai_level: 2, required_level: 3, is_override: true, result: 'exceed', delta: 1)
    end

    it 'marks a required skill the candidate was never assessed on as not_assessed' do
      engine = build_engine(portfolio_skills: [], vacancy_skills: [VSkill.new(1, 'sql', 'SQL', 3)], gemini: ok_gemini)
      row = saved_attrs { engine.call }[:skill_comparisons].first

      expect(row).to include(candidate_level: nil, result: 'not_assessed', delta: nil, is_override: false)
    end

    it 'matches skills by label case-insensitively when ids are missing' do
      engine = build_engine(
        portfolio_skills: [PSkill.new(10, nil, 'ruby on rails', 3, 'medium', nil)],
        vacancy_skills:   [VSkill.new(1, nil, 'Ruby On Rails', 3)],
        gemini:           ok_gemini
      )
      expect(saved_attrs { engine.call }[:skill_comparisons].first[:result]).to eq('match')
    end

    it 'stores an AI narrative with source "ai"' do
      engine = build_engine(portfolio_skills: [], vacancy_skills: [VSkill.new(1, 'sql', 'SQL', 3)], gemini: ok_gemini)
      attrs = saved_attrs { engine.call }

      expect(attrs).to include(overall_narrative: 'Strong.', culture_narrative: 'Culture ok.', narrative_source: 'ai')
    end

    context 'when the model call fails' do
      it 'falls back to a deterministic narrative that mentions unassessed skills' do
        gemini = double('Gemini')
        allow(gemini).to receive(:generate_content).and_raise(Timeout::Error)
        engine = build_engine(portfolio_skills: [], vacancy_skills: [VSkill.new(1, 'sql', 'SQL', 3)], gemini: gemini)
        attrs = saved_attrs { engine.call }

        expect(attrs[:narrative_source]).to eq('fallback')
        expect(attrs[:overall_narrative]).to include('could not be assessed')
        expect(attrs[:culture_narrative]).to be_nil
      end
    end

    context 'when the model returns malformed output' do
      [
        ['an array',               [1, 2]],
        ['a non-JSON string',      'sorry, I cannot do that'],
        ['nil',                    nil],
        ['non-string fields',      { 'overall_narrative' => 42, 'culture_narrative' => {} }],
        ['a blank overall field',  { 'overall_narrative' => '   ' }]
      ].each do |label, payload|
        it "falls back instead of raising for #{label}" do
          gemini = double('Gemini', generate_content: payload)
          engine = build_engine(portfolio_skills: [], vacancy_skills: [VSkill.new(1, 'sql', 'SQL', 3)], gemini: gemini)

          expect(saved_attrs { engine.call }[:narrative_source]).to eq('fallback')
        end
      end
    end

    it 'truncates a runaway model narrative' do
      gemini = double('Gemini', generate_content: { 'overall_narrative' => 'x' * 10_000, 'culture_narrative' => 'ok' })
      engine = build_engine(portfolio_skills: [], vacancy_skills: [VSkill.new(1, 'sql', 'SQL', 3)], gemini: gemini)

      expect(saved_attrs { engine.call }[:overall_narrative].length).to be <= described_class::NARRATIVE_MAX_CHARS
    end

    it 'handles a vacancy with no required skills without calling the model' do
      gemini = double('Gemini')
      expect(gemini).not_to receive(:generate_content)
      engine = build_engine(portfolio_skills: [], vacancy_skills: [], gemini: gemini)
      attrs = saved_attrs { engine.call }

      expect(attrs[:skill_comparisons]).to eq([])
      expect(attrs[:summary]).to include(total: 0, coverage_pct: nil)
    end

    it 'retries once when a duplicate job wins the insert race' do
      engine = build_engine(portfolio_skills: [], vacancy_skills: [], gemini: ok_gemini)
      calls = 0
      allow(report).to receive(:update!) do
        calls += 1
        raise ActiveRecord::RecordNotUnique, 'duplicate' if calls == 1

        true
      end

      expect { engine.call }.not_to raise_error
      expect(calls).to eq(2)
    end
  end
end
