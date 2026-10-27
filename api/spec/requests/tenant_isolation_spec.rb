# frozen_string_literal: true

require 'rails_helper'

# Regression guard for the P0 finding: PortfolioSkill/Portfolio lookups used to be
# unscoped, so an assessor of tenant B could read or change tenant A's candidates.
RSpec.describe 'Tenant isolation', type: :request do
  def make_org(scheme)
    Organization.find_or_create_by!(scheme: scheme) do |o|
      o.name = scheme
      o.identifier = scheme
      o.host = "#{scheme}.localhost"
    end
  end

  def auth_for(org)
    token = JsonWebToken.encode({ user_id: 1, role: 'admin', scheme: org.scheme })
    { 'Authorization' => "Bearer #{token}" }
  end

  let!(:org_a) { make_org('spec-tenant-a') }
  let!(:org_b) { make_org('spec-tenant-b') }

  # A candidate portfolio that belongs to tenant A.
  let!(:portfolio_skill) do
    assessment = Assessment.create!(tenant_id: org_a.id, created_by: 1, name: 'A', time_limit_min: 30)
    session    = Session.create!(tenant_id: org_a.id, assessment: assessment)
    portfolio  = Portfolio.create!(session: session, generation_status: 'complete')
    portfolio.portfolio_skills.create!(
      skill_label: 'Ruby', ai_level: 2, ai_confidence: 'high', competency_summary: 'Works independently.'
    )
  end

  let(:override_body) { { override: { override_level: 5, assessor_notes: 'x' } } }

  describe 'POST /api/v1/portfolio_skills/:id/override' do
    it "rejects another tenant's assessor with 404 and writes nothing" do
      expect do
        post "/api/v1/portfolio_skills/#{portfolio_skill.id}/override",
             params: override_body, headers: auth_for(org_b), as: :json
      end.not_to change(AssessorOverride, :count)

      expect(response).to have_http_status(:not_found)
    end

    it 'still lets the owning tenant override its own candidate' do
      expect do
        post "/api/v1/portfolio_skills/#{portfolio_skill.id}/override",
             params: override_body, headers: auth_for(org_a), as: :json
      end.to change(AssessorOverride, :count).by(1)

      expect(response).to have_http_status(:created)
    end
  end

    describe 'POST /api/v1/portfolios/:id/regenerate_fitgap' do
    # Tenant B has a valid vacancy of its own, so the only reason to refuse is that
    # the portfolio belongs to tenant A.
    let!(:vacancy_b) { Vacancy.create!(tenant_id: org_b.id, created_by: 1, role_title: 'B role') }

    it "does not queue work for another tenant's portfolio" do
      expect(FitGapGeneratorWorker).not_to receive(:perform_async)

      post "/api/v1/portfolios/#{portfolio_skill.portfolio_id}/regenerate_fitgap",
           params: { vacancy_id: vacancy_b.id }, headers: auth_for(org_b), as: :json

      expect(response).to have_http_status(:not_found)
    end
  end
end