-- migration 322: add journey_id to issues table
-- Needed so warroom /line/:id/command can show open issues per line.

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS journey_id UUID REFERENCES journeys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_issues_journey_id
  ON issues (journey_id)
  WHERE journey_id IS NOT NULL;
