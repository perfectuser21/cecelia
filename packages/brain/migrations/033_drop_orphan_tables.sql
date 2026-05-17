-- Migration 033: Drop orphan tables
-- These tables are no longer referenced by any code:
-- - publishing_tasks, publishing_records, publishing_credentials: Publishing System removed
-- - system_snapshot: read-only, never written to (perception.js was deleted)

BEGIN;

DROP TABLE IF EXISTS publishing_tasks CASCADE;
DROP TABLE IF EXISTS publishing_records CASCADE;
DROP TABLE IF EXISTS publishing_credentials CASCADE;
DROP TABLE IF EXISTS system_snapshot CASCADE;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('033', 'Drop orphan tables (publishing system, system_snapshot)', NOW());

COMMIT;
