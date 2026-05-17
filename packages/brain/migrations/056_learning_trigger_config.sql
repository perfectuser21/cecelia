-- Migration: Add learning trigger configuration
-- Version: 056
-- Date: 2026-02-22
-- Description: Add configurable trigger conditions for Learning to Strategy conversion

-- Add columns to learnings table for trigger tracking
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS trigger_conditions JSONB;
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS quality_score FLOAT;
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS trigger_source VARCHAR(50);
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS triggered_at TIMESTAMP;

-- Add columns for trigger monitoring
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS time_window_minutes INT;
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS frequency_count INT;
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS frequency_window_hours INT;

-- Seed default trigger configuration
INSERT INTO brain_config (key, value) VALUES
  ('learning.trigger.enabled', 'true')
ON CONFLICT (key) DO NOTHING;

INSERT INTO brain_config (key, value) VALUES
  ('learning.trigger.time_window_minutes', '60')
ON CONFLICT (key) DO NOTHING;

INSERT INTO brain_config (key, value) VALUES
  ('learning.trigger.frequency_threshold', '3')
ON CONFLICT (key) DO NOTHING;

INSERT INTO brain_config (key, value) VALUES
  ('learning.trigger.frequency_window_hours', '24')
ON CONFLICT (key) DO NOTHING;

INSERT INTO brain_config (key, value) VALUES
  ('learning.trigger.quality_threshold', '0.7')
ON CONFLICT (key) DO NOTHING;

INSERT INTO brain_config (key, value) VALUES
  ('learning.trigger.require_all_conditions', 'false')
ON CONFLICT (key) DO NOTHING;

-- Insert schema version
INSERT INTO schema_version (version, description)
VALUES ('056', 'Add learning trigger configuration')
ON CONFLICT (version) DO NOTHING;
