-- Migration 124: system_modules table for /architect Mode 1
-- Stores human-readable module documentation for Dashboard SuperBrain page

CREATE TABLE IF NOT EXISTS system_modules (
  id              SERIAL PRIMARY KEY,
  module_id       TEXT NOT NULL UNIQUE,          -- e.g. 'thalamus', 'executor'
  filename        TEXT NOT NULL,                  -- e.g. 'thalamus.js'
  display_name    TEXT NOT NULL,                  -- e.g. 'L1 丘脑'
  icon            TEXT DEFAULT '',                -- emoji or icon identifier
  chapter         TEXT NOT NULL,                  -- interface/perception/core/action/evolution
  analogy         TEXT DEFAULT '',                -- e.g. '大脑的快速判断门'
  role_description TEXT NOT NULL,                 -- human-readable role description (Chinese)
  inputs          TEXT DEFAULT '',                -- what goes in
  outputs         TEXT DEFAULT '',                -- what comes out
  dependencies    JSONB DEFAULT '[]'::jsonb,      -- modules this depends on
  dependents      JSONB DEFAULT '[]'::jsonb,      -- modules that depend on this
  risk_notes      TEXT DEFAULT '',                -- what breaks if you change this
  call_frequency  TEXT DEFAULT '',                -- per-tick / per-event / on-demand
  llm_model       TEXT DEFAULT '',                -- Haiku/Sonnet/Opus/none
  content_hash    TEXT DEFAULT '',                -- file content hash for incremental updates
  last_updated    TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index for chapter-based queries (Dashboard grouping)
CREATE INDEX IF NOT EXISTS idx_system_modules_chapter ON system_modules(chapter);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_system_modules_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_system_modules_updated ON system_modules;
CREATE TRIGGER trg_system_modules_updated
  BEFORE UPDATE ON system_modules
  FOR EACH ROW EXECUTE FUNCTION update_system_modules_timestamp();
