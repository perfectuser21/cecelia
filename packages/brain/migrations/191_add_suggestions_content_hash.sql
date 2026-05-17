-- Migration 191: Add content_hash to suggestions for dedup (P0 Rumination→Desire dead-loop fix)

ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_suggestions_content_hash ON suggestions(content_hash, created_at DESC)
  WHERE content_hash IS NOT NULL;

INSERT INTO schema_version (version, description) VALUES ('191', 'add_suggestions_content_hash') ON CONFLICT DO NOTHING;
