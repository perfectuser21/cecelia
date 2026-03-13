-- Migration: Add occurrence_count, error_type, updated_at to learnings table
-- Version: 152
-- Date: 2026-03-12
-- Description: Support failure learning deduplication.
--   - occurrence_count: how many times same failure was observed (merging duplicates)
--   - error_type: FAILURE_CLASS value (auth/network/rate_limit/billing_cap/unknown)
--   - updated_at: last merge timestamp

-- 1. Add occurrence_count
ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS occurrence_count INTEGER DEFAULT 1;

-- 2. Add error_type for FAILURE_CLASS grouping
ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS error_type VARCHAR(50);

-- 3. Add updated_at for tracking merge timestamp
ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

-- 4. Indexes for dedup lookup
CREATE INDEX IF NOT EXISTS idx_learnings_error_type
  ON learnings (error_type)
  WHERE error_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_learnings_category_error_type
  ON learnings (category, error_type)
  WHERE error_type IS NOT NULL;

-- 5. Schema version
INSERT INTO schema_version (version, description)
VALUES ('152', 'Add occurrence_count, error_type, updated_at to learnings for failure deduplication')
ON CONFLICT (version) DO NOTHING;
