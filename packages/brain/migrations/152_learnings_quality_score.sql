-- Migration: Add quality_score and source_type fields to learnings table
-- Version: 152
-- Date: 2026-03-12
-- Description: Knowledge filter Initiative PR1 — add quality scoring and source classification
--   quality_score: 0-100 integer, NULL means unscored
--   source_type: 'test_run' | 'real_insight' | 'unknown'

-- 1. Add quality_score field
ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS quality_score INTEGER DEFAULT NULL;

-- 2. Add check constraint for quality_score range
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'learnings_quality_score_check'
  ) THEN
    ALTER TABLE learnings
      ADD CONSTRAINT learnings_quality_score_check
        CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 100));
  END IF;
END $$;

-- 3. Add source_type field
ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) DEFAULT NULL;

-- 4. Add check constraint for source_type values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'learnings_source_type_check'
  ) THEN
    ALTER TABLE learnings
      ADD CONSTRAINT learnings_source_type_check
        CHECK (source_type IS NULL OR source_type IN (
          'test_run',
          'real_insight',
          'unknown'
        ));
  END IF;
END $$;

-- 5. Index on quality_score for filtering high-quality learnings
CREATE INDEX IF NOT EXISTS idx_learnings_quality_score
  ON learnings (quality_score)
  WHERE quality_score IS NOT NULL;

-- 6. Schema version
INSERT INTO schema_version (version, description)
VALUES ('152', 'Add quality_score (0-100) and source_type (test_run/real_insight/unknown) to learnings table')
ON CONFLICT (version) DO NOTHING;
