-- Migration: Add occurrence deduplication fields to learnings table
-- Version: 153
-- Date: 2026-03-12
-- Description: Support same-type failure learning aggregation to reduce noise.
--   occurrence_count: how many times this learning pattern was observed
--   error_type: extracted failure class for grouping (e.g. 'OAUTH_401', 'NETWORK_TIMEOUT')
--   updated_at: last merge timestamp

-- 1. Add occurrence_count
ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS occurrence_count INTEGER DEFAULT 1;

-- 2. Add error_type for grouping same-class failures
ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS error_type VARCHAR(100);

-- 3. Add updated_at for tracking last merge time
ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- 4. Index for fast 24h window lookup by category + error_type
CREATE INDEX IF NOT EXISTS idx_learnings_error_type_category
  ON learnings (category, error_type, created_at)
  WHERE error_type IS NOT NULL;

-- 5. Schema version
INSERT INTO schema_version (version, description)
VALUES ('153', 'Add occurrence_count, error_type, updated_at to learnings for failure dedup')
ON CONFLICT (version) DO NOTHING;
