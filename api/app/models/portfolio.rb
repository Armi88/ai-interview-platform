# frozen_string_literal: true

class Portfolio < ApplicationRecord
  GENERATION_STATUSES = %w[pending generating complete failed].freeze

  belongs_to :session
  has_many :portfolio_skills, dependent: :destroy
  has_many :assessor_overrides, through: :portfolio_skills

  validates :generation_status, inclusion: { in: GENERATION_STATUSES }

  scope :complete,    -> { where(generation_status: 'complete') }
  scope :failed,      -> { where(generation_status: 'failed') }
  scope :generating,  -> { where(generation_status: 'generating') }

  # Portfolio has no tenant_id of its own; it inherits tenancy from its session.
  # Session carries the TenantScoped default_scope, so the sub-select below only
  # matches sessions of the current tenant. Always use this for request-facing
  # lookups so one tenant can never read or mutate another tenant's candidates.
  scope :for_current_tenant, -> { where(session_id: Session.select(:id)) }

  def complete?    = generation_status == 'complete'
  def generating?  = generation_status == 'generating'
  def failed?      = generation_status == 'failed'
end
