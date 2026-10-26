# frozen_string_literal: true

module FitGap
  # N13: Generates a fit/gap report comparing a portfolio against a vacancy.
  # Uses rule-based comparison for skill levels + Gemini Flash for the narrative.
  #
  # Design rules (see assessment/ADR notes in the PR):
  #  * "not_assessed" is NOT a gap. The interview simply never produced evidence,
  #    so we report coverage separately and never fold it into a fit score.
  #  * The rule-based comparison is the source of truth. The LLM only writes prose;
  #    if it fails or returns garbage we fall back to a deterministic narrative
  #    and flag it (narrative_source = 'fallback') so the UI can say so.
  class Engine
    NARRATIVE_MAX_CHARS = 1_200

    def initialize(portfolio:, vacancy:, gemini_client: nil)
      @portfolio = portfolio
      @vacancy   = vacancy
      @gemini_client = gemini_client || Gemini::HttpClient.new(
        model:   ENV.fetch('GEMINI_FLASH_MODEL', 'gemini-2.0-flash-001'),
        timeout: 30
      )
    end

    # Returns the FitGapReport record. Safe to run twice concurrently: the unique
    # index on (portfolio_id, vacancy_id) arbitrates and the loser updates.
    def call
      skill_comparisons = build_skill_comparisons
      summary           = self.class.summarize(skill_comparisons)
      narratives        = generate_narratives(skill_comparisons, summary)

      attrs = {
        skill_comparisons: skill_comparisons,
        summary:           summary,
        culture_narrative: narratives[:culture],
        overall_narrative: narratives[:overall],
        narrative_source:  narratives[:source],
        generated_at:      Time.current
      }

      report = persist(attrs)
      Rails.logger.info("[N13] Fit/gap report generated: portfolio=#{@portfolio.id} vacancy=#{@vacancy.id} source=#{narratives[:source]}")
      report
    end

    # Pure function so it can be tested without a database.
    def self.summarize(comparisons)
      total    = comparisons.size
      counts   = FitGapReport::FIT_RESULTS.index_with { |r| comparisons.count { |c| c[:result] == r } }
      assessed = total - counts['not_assessed']

      {
        total:        total,
        assessed:     assessed,
        match:        counts['match'],
        exceed:       counts['exceed'],
        gap:          counts['gap'],
        not_assessed: counts['not_assessed'],
        # Share of required skills the interview actually produced evidence for.
        coverage_pct: total.zero? ? nil : ((assessed * 100.0) / total).round
      }
    end

    # Pure comparison of one candidate level against one expected level.
    def self.compare_levels(candidate_level, expected_level)
      return { result: 'gap', delta: nil } if candidate_level.nil?

      delta  = candidate_level - expected_level
      result = delta.zero? ? 'match' : (delta.positive? ? 'exceed' : 'gap')
      { result: result, delta: delta }
    end

    private

    def persist(attrs)
      attempts = 0
      begin
        report = FitGapReport.find_or_initialize_by(portfolio_id: @portfolio.id, vacancy_id: @vacancy.id)
        report.update!(attrs)
        report
      rescue ActiveRecord::RecordNotUnique
        # A duplicate job inserted the row between our find and insert.
        attempts += 1
        retry if attempts < 2
        raise
      end
    end

    def build_skill_comparisons
      portfolio_skills = effective_portfolio_skills

      @vacancy.vacancy_skills.order(:id).map do |vacancy_skill|
        label           = vacancy_skill.skill_label
        portfolio_skill = find_portfolio_skill(portfolio_skills, label, vacancy_skill.skill_id)
        expected_level  = vacancy_skill.expected_level
        candidate_level = portfolio_skill&.dig(:effective_level)
        outcome         = self.class.compare_levels(candidate_level, expected_level)

        {
          skill_label:     label,
          skill_id:        vacancy_skill.skill_id,
          required_level:  expected_level,
          expected_level:  expected_level, # kept for backward compatibility
          candidate_level: candidate_level,
          ai_level:        portfolio_skill&.dig(:ai_level),
          is_override:     portfolio_skill ? portfolio_skill[:overridden] : false,
          result:          outcome[:result],
          delta:           outcome[:delta],
          confidence:      portfolio_skill&.dig(:confidence)
        }
      end
    end

    # Returns portfolio skills with overrides applied.
    def effective_portfolio_skills
      @portfolio.portfolio_skills.includes(:assessor_override).map do |skill|
        override = skill.assessor_override
        {
          id:              skill.id,
          skill_id:        skill.skill_id,
          skill_label:     skill.skill_label,
          ai_level:        skill.ai_level,
          effective_level: override ? override.override_level : skill.ai_level,
          confidence:      skill.ai_confidence,
          overridden:      override.present?
        }
      end
    end

    def find_portfolio_skill(portfolio_skills, label, skill_id)
      portfolio_skills.find { |s| skill_id.present? && s[:skill_id] == skill_id } ||
        portfolio_skills.find { |s| s[:skill_label].to_s.casecmp?(label.to_s) }
    end

    def generate_narratives(skill_comparisons, summary)
      # Nothing to narrate: don't spend a model call on an empty comparison.
      return fallback(skill_comparisons, summary) if skill_comparisons.empty?

      prompt = build_narrative_prompt(skill_comparisons, summary)
      data   = parse_model_response(@gemini_client.generate_content(prompt, temperature: 0.4))
      culture = clean_text(data['culture_narrative'])
      overall = clean_text(data['overall_narrative'])

      return fallback(skill_comparisons, summary) if overall.nil?

      { culture: culture, overall: overall, source: 'ai' }
    rescue StandardError => e
      # Class only: messages from upstream can echo prompt content (candidate data).
      Rails.logger.error("[N13] Narrative generation failed: #{e.class}")
      fallback(skill_comparisons, summary)
    end

    def parse_model_response(response)
      data = response.is_a?(Hash) ? response : JSON.parse(response.to_s)
      raise TypeError, 'model response is not an object' unless data.is_a?(Hash)

      data
    end

    # Models sometimes return arrays, numbers or megabytes of text. Accept only a
    # non-blank String and cap its size.
    def clean_text(value)
      return nil unless value.is_a?(String)

      text = value.strip
      return nil if text.empty?

      text.truncate(NARRATIVE_MAX_CHARS)
    end

    def fallback(comparisons, summary)
      { culture: nil, overall: self.class.fallback_narrative(comparisons, summary), source: 'fallback' }
    end

    def self.fallback_narrative(comparisons, summary)
      return 'This vacancy has no required skills, so there is nothing to compare yet.' if comparisons.empty?

      text = "Of #{summary[:total]} required skills, #{summary[:assessed]} were assessed: " \
             "#{summary[:match]} match, #{summary[:exceed]} exceed and #{summary[:gap]} fall short."
      if summary[:not_assessed].positive?
        text += " #{summary[:not_assessed]} could not be assessed in this interview and should not be read as a weakness."
      end
      text
    end

    def build_narrative_prompt(comparisons, summary)
      by = ->(r) { comparisons.select { |c| c[:result] == r } }

      <<~PROMPT
        You are writing a fit/gap analysis narrative for a candidate evaluation.
        A skill listed under "Not assessed" means the interview produced no evidence for it.
        It is NOT evidence of weakness; never describe it as a gap.

        ROLE: #{@vacancy.role_title}
        #{@vacancy.culture_dimensions.present? ? "CULTURE EXPECTATIONS:\n#{@vacancy.culture_dimensions}\n" : ''}
        #{@vacancy.competency_expectations.present? ? "COMPETENCY EXPECTATIONS:\n#{@vacancy.competency_expectations}\n" : ''}

        SKILL COMPARISON RESULTS (#{summary[:assessed]} of #{summary[:total]} skills assessed):
        - Matches (#{by.call('match').size}): #{by.call('match').map { |c| "#{c[:skill_label]} (L#{c[:candidate_level]})" }.join(', ')}
        - Gaps (#{by.call('gap').size}): #{by.call('gap').map { |c| "#{c[:skill_label]}: candidate L#{c[:candidate_level]} vs expected L#{c[:required_level]} (delta #{c[:delta]})" }.join(', ')}
        - Exceeds (#{by.call('exceed').size}): #{by.call('exceed').map { |c| "#{c[:skill_label]}: candidate L#{c[:candidate_level]} vs expected L#{c[:required_level]} (+#{c[:delta]})" }.join(', ')}
        - Not assessed (#{by.call('not_assessed').size}): #{by.call('not_assessed').map { |c| c[:skill_label] }.join(', ')}

        Write two short narrative paragraphs:
        1. culture_narrative: 2-3 sentences on culture/competency fit based on the comparison patterns.
        2. overall_narrative: 2-3 sentence overall summary for the hiring manager. Mention what could not be assessed.

        OUTPUT (JSON only):
        {
          "culture_narrative": "...",
          "overall_narrative": "..."
        }
      PROMPT
    end
  end
end
