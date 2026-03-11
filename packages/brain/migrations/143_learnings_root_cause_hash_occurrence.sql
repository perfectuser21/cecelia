-- Migration: Add root_cause_hash and occurrence_count to learnings table
-- Version: 143
-- Date: 2026-03-11
-- Description: Add category classification hash and occurrence counter for dedup/aggregation

-- Add root_cause_hash: SHA-256 of normalized root cause content (first 16 chars)
-- Distinct from content_hash (which hashes title+content for dedup)
-- root_cause_hash focuses on the root cause signal, stripping timestamps/variable names
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS root_cause_hash VARCHAR(64);

-- Add occurrence_count: tracks how many times the same root cause was observed
-- Increments on dedup when root_cause_hash matches an existing record
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS occurrence_count INTEGER DEFAULT 1;

-- Index for root_cause_hash lookups (aggregation queries)
CREATE INDEX IF NOT EXISTS idx_learnings_root_cause_hash ON learnings(root_cause_hash) WHERE root_cause_hash IS NOT NULL;

-- Insert schema version
INSERT INTO schema_version (version, description)
VALUES ('143', 'Add root_cause_hash and occurrence_count to learnings table')
ON CONFLICT (version) DO NOTHING;
