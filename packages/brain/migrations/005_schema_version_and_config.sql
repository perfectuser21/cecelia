-- Migration 005: Schema version tracking + brain config
-- Purpose: Enable startup self-check and region-aware deployment

-- schema_version: records which migrations have been applied
CREATE TABLE IF NOT EXISTS schema_version (
  version VARCHAR(10) PRIMARY KEY,
  description TEXT,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- brain_config: stores region identity and configuration fingerprint
CREATE TABLE IF NOT EXISTS brain_config (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Back-fill existing migrations + this one
INSERT INTO schema_version (version, description) VALUES
  ('001', 'cecelia_architecture_upgrade'),
  ('002', 'task_type_review_merge'),
  ('003', 'feature_tick_system'),
  ('004', 'trigger_source'),
  ('005', 'schema_version_and_config')
ON CONFLICT (version) DO NOTHING;

-- Seed region config
INSERT INTO brain_config (key, value) VALUES ('region', 'us')
ON CONFLICT (key) DO NOTHING;
