-- Migration 034: Cleanup orphan tables and fix constraints
--
-- 1. Drop orphan tables that have no references in code
-- 2. Fix task_type constraint to include all valid types

-- Drop orphan tables
DROP TABLE IF EXISTS areas CASCADE;
DROP TABLE IF EXISTS cortex_quality_reports CASCADE;

-- Fix task_type constraint to match task-router.js LOCATION_MAP
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check
  CHECK (task_type IN ('dev', 'review', 'talk', 'data', 'research', 'exploratory', 'qa', 'audit'));

-- Update schema_version
INSERT INTO schema_version (version, applied_at) VALUES ('034', NOW());
