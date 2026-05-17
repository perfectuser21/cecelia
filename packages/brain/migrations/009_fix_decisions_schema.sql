-- Migration 009: Fix decisions table schema
-- The decisions table was created outside migrations with strategic-decision columns.
-- decision.js expects operational columns (trigger, context, actions, confidence).
-- This migration creates the table if missing (CI) or alters it if it exists (production).

-- 1. Create table if not exists (CI fresh DB)
CREATE TABLE IF NOT EXISTS decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category varchar(50),
  topic varchar(200),
  decision text,
  reason text,
  status varchar(20) DEFAULT 'active',
  superseded_by uuid,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  trigger text,
  context jsonb,
  actions jsonb,
  confidence numeric,
  executed_at timestamp
);

-- 2. For existing tables (production): add missing columns
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS trigger text;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS context jsonb;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS actions jsonb;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS confidence numeric;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS executed_at timestamp;

-- 3. Relax NOT NULL on old columns (safe even if already nullable)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'decisions' AND column_name = 'category' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE decisions ALTER COLUMN category DROP NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'decisions' AND column_name = 'topic' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE decisions ALTER COLUMN topic DROP NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'decisions' AND column_name = 'decision' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE decisions ALTER COLUMN decision DROP NOT NULL;
  END IF;
END $$;

-- 4. Update schema version
INSERT INTO schema_version (version, description, applied_at)
VALUES ('009', 'Fix decisions table schema for decision engine', NOW())
ON CONFLICT (version) DO NOTHING;
