-- Migration: Add deduplication fields to learnings table
-- Version: 063
-- Date: 2026-02-23
-- Description: Add content_hash, version, parent_id, and is_latest fields for learning deduplication and version management

-- Add content_hash for deduplication (SHA-256 hash of content)
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);

-- Add version field for version tracking
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;

-- Add parent_id to link version history (self-reference to previous learning)
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES learnings(id);

-- Add is_latest to mark latest version
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS is_latest BOOLEAN DEFAULT true;

-- Create index for deduplication lookup
CREATE INDEX IF NOT EXISTS idx_learnings_content_hash ON learnings(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_learnings_is_latest ON learnings(is_latest) WHERE is_latest = true;

-- Insert schema version
INSERT INTO schema_version (version, description)
VALUES ('063', 'Add deduplication fields to learnings table')
ON CONFLICT (version) DO NOTHING;
