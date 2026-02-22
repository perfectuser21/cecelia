-- Migration 045: Add completed_at to projects table for initiative lifecycle tracking
-- Used by initiative-closer.js to record when an initiative is marked complete

ALTER TABLE projects ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

INSERT INTO schema_version (version, description) VALUES ('045', 'Add completed_at to projects table for initiative lifecycle tracking')
  ON CONFLICT (version) DO NOTHING;
