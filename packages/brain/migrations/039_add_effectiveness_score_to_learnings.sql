-- Migration 039: Add effectiveness_score and rollback_needed to learnings table
-- Track learning effectiveness and rollback status for quality feedback loop

ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS effectiveness_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS rollback_needed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS effectiveness_evaluated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_learnings_effectiveness_score ON learnings(effectiveness_score);
CREATE INDEX IF NOT EXISTS idx_learnings_rollback_needed ON learnings(rollback_needed) WHERE rollback_needed = true;
