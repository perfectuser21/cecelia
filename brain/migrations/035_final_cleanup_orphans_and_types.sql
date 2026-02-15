-- Migration 035: Final cleanup of orphan tables and goal types
--
-- 1. Drop remaining orphan tables (features, key_results)
-- 2. Fix goal type values (objective → global_okr/area_okr)
-- 3. Add goal type constraint

BEGIN;

-- ============================================================
-- 1. Drop orphan tables
-- ============================================================
-- These tables were supposed to be dropped in Migration 027
-- but may have been recreated or not properly cleaned up

DROP TABLE IF EXISTS features CASCADE;
DROP TABLE IF EXISTS key_results CASCADE;

-- ============================================================
-- 2. Fix goal type values
-- ============================================================
-- Migrate old 'objective' type to proper OKR types

-- Top-level objectives (no parent) → global_okr
UPDATE goals
SET type = 'global_okr'
WHERE type = 'objective' AND parent_id IS NULL;

-- Child objectives (has parent) → area_okr
UPDATE goals
SET type = 'area_okr'
WHERE type = 'objective' AND parent_id IS NOT NULL;

-- Fix any remaining 'key_result' to 'kr'
UPDATE goals
SET type = 'kr'
WHERE type = 'key_result';

-- ============================================================
-- 3. Add goal type constraint
-- ============================================================
-- Ensure only valid types can be used going forward

ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_type_check;
ALTER TABLE goals ADD CONSTRAINT goals_type_check
  CHECK (type IN ('global_okr', 'area_okr', 'kr'));

-- ============================================================
-- 4. Update schema_version
-- ============================================================

INSERT INTO schema_version (version, description, applied_at)
VALUES ('035', 'Final cleanup: drop orphan tables (features, key_results), fix goal types, add type constraint', NOW());

COMMIT;
