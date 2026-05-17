-- Migration: Create learnings table for Brain self-learning loop
-- Version: 012
-- Date: 2026-02-07
-- Description: Store learning records from RCA analysis for continuous improvement

CREATE TABLE IF NOT EXISTS learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  category VARCHAR(50),  -- 'failure_pattern', 'optimization', 'strategy_adjustment'
  trigger_event VARCHAR(100),  -- Event type that triggered learning (e.g., 'systemic_failure', 'alertness_emergency')
  content TEXT,  -- Learning content description
  strategy_adjustments JSONB,  -- Strategy adjustment recommendations
  applied BOOLEAN DEFAULT false,  -- Whether adjustments have been applied
  applied_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category);
CREATE INDEX IF NOT EXISTS idx_learnings_trigger_event ON learnings(trigger_event);
CREATE INDEX IF NOT EXISTS idx_learnings_created_at ON learnings(created_at);
CREATE INDEX IF NOT EXISTS idx_learnings_applied ON learnings(applied);

-- Insert schema version
INSERT INTO schema_version (version, description)
VALUES ('012', 'Create learnings table for Brain self-learning loop');
