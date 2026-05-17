-- Migration 016: Immune System Connections
-- Connects all immune system components:
-- 1. Strategy effectiveness tracking
-- 2. Quality feedback loop (user feedback + reoccurrence)

-- 1. Strategy Effectiveness Tracking Table
CREATE TABLE IF NOT EXISTS strategy_effectiveness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adoption_id UUID UNIQUE REFERENCES strategy_adoptions(id) ON DELETE CASCADE,
  strategy_key TEXT NOT NULL,
  baseline_success_rate NUMERIC(5,2),  -- Success rate before adjustment
  post_adjustment_success_rate NUMERIC(5,2),  -- Success rate after adjustment
  sample_size INTEGER,  -- Number of tasks evaluated
  evaluation_period_days INTEGER DEFAULT 7,
  is_effective BOOLEAN,  -- Success rate improvement > 5%
  improvement_percentage NUMERIC(5,2),  -- Actual improvement %
  evaluated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_effectiveness_strategy_key ON strategy_effectiveness(strategy_key);

-- 2. Quality Feedback Loop - Add columns to cortex_analyses
ALTER TABLE cortex_analyses ADD COLUMN IF NOT EXISTS user_feedback INTEGER;  -- 1-5 star rating
ALTER TABLE cortex_analyses ADD COLUMN IF NOT EXISTS feedback_comment TEXT;
ALTER TABLE cortex_analyses ADD COLUMN IF NOT EXISTS reoccurrence_count INTEGER DEFAULT 0;  -- How many times same issue happened
ALTER TABLE cortex_analyses ADD COLUMN IF NOT EXISTS last_reoccurrence_at TIMESTAMPTZ;
ALTER TABLE cortex_analyses ADD COLUMN IF NOT EXISTS feedback_updated_at TIMESTAMPTZ;

-- Update schema version
INSERT INTO schema_version (version, description, applied_at)
VALUES ('016', 'Immune System Connections - strategy effectiveness tracking and quality feedback', NOW());
