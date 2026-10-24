# frozen_string_literal: true

require 'rails_helper'

RSpec.describe Coverage::StateEngine do
  describe '.resolve_state' do
    it 'never advances past initiated with fewer than 2 probes' do
      expect(described_class.resolve_state(current_state: 'not_yet', proposed_state: 'covered', probe_count: 1))
        .to eq('initiated')
    end

    it 'walks forward one step at a time once the probe gate is met' do
      expect(described_class.resolve_state(current_state: 'not_yet', proposed_state: 'covered', probe_count: 2))
        .to eq('covered')
    end

    it 'ignores backwards and unknown proposals' do
      expect(described_class.resolve_state(current_state: 'partial', proposed_state: 'initiated', probe_count: 5)).to eq('partial')
      expect(described_class.resolve_state(current_state: 'partial', proposed_state: 'bogus', probe_count: 5)).to eq('partial')
    end
  end
end
