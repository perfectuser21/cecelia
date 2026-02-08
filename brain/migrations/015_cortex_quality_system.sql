-- Migration 015: Cortex Quality Assessment System
-- Adds quality scoring, similarity detection, and effectiveness tracking

-- 1. Add quality tracking columns to cortex_analyses
ALTER TABLE cortex_analyses ADD COLUMN IF NOT EXISTS quality_score INTEGER;
ALTER TABLE cortex_analyses ADD COLUMN IF NOT EXISTS quality_dimensions JSONB;
ALTER TABLE cortex_analyses ADD COLUMN IF NOT EXISTS similarity_hash TEXT;
ALTER TABLE cortex_analyses ADD COLUMN IF NOT EXISTS duplicate_of UUID REFERENCES cortex_analyses(id);

-- Add index for similarity lookups
CREATE INDEX IF NOT EXISTS idx_cortex_analyses_similarity_hash ON cortex_analyses(similarity_hash);
CREATE INDEX IF NOT EXISTS idx_cortex_analyses_duplicate_of ON cortex_analyses(duplicate_of);

-- 2. Create cortex_quality_reports table
CREATE TABLE IF NOT EXISTS cortex_quality_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_period_start TIMESTAMPTZ NOT NULL,
  report_period_end TIMESTAMPTZ NOT NULL,
  total_rcas INTEGER NOT NULL DEFAULT 0,
  avg_quality_score NUMERIC(5,2),
  top_quality_analyses JSONB,
  low_quality_analyses JSONB,
  aggregation_stats JSONB,
  adoption_stats JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create strategy_adoptions table
CREATE TABLE IF NOT EXISTS strategy_adoptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES cortex_analyses(id) ON DELETE CASCADE,
  strategy_key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  adopted_at TIMESTAMPTZ,
  adopted_by TEXT,
  effectiveness_score INTEGER,
  evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for query performance
CREATE INDEX IF NOT EXISTS idx_strategy_adoptions_analysis_id ON strategy_adoptions(analysis_id);
CREATE INDEX IF NOT EXISTS idx_strategy_adoptions_strategy_key ON strategy_adoptions(strategy_key);

-- Update schema_version
INSERT INTO schema_version (version, description, applied_at)
VALUES ('015', 'Cortex quality assessment system', NOW());
