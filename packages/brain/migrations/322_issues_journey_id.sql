-- Migration 322: Add journey_id to issues table
ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS journey_id UUID REFERENCES journeys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_issues_journey_id ON issues (journey_id)
  WHERE journey_id IS NOT NULL;
