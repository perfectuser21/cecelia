-- Rollback 493：视图还原 → 旧表名还原 → 删列（顺序不能反：kind 被视图引用，删列前先删视图）
BEGIN;
DELETE FROM notion_projection_map WHERE notion_db_id = 'unmapped:capabilities' AND brain_table = 'capabilities';
DROP VIEW IF EXISTS capabilities;
DROP VIEW IF EXISTS value_streams;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'capabilities_legacy' AND c.relkind = 'r' AND n.nspname = current_schema()
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'capabilities' AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE capabilities_legacy RENAME TO capabilities;
  END IF;
END $$;
DROP INDEX IF EXISTS idx_journeys_kind;
ALTER TABLE journeys DROP COLUMN IF EXISTS kind;
CREATE OR REPLACE VIEW value_streams AS SELECT * FROM journeys;
DROP INDEX IF EXISTS idx_areas_parent_area_id;
ALTER TABLE areas DROP CONSTRAINT IF EXISTS areas_parent_not_self;
ALTER TABLE areas DROP COLUMN IF EXISTS parent_area_id;
DELETE FROM schema_version WHERE version = '493';
COMMIT;
