BEGIN;
ALTER TABLE initiative_runs DROP CONSTRAINT IF EXISTS initiative_runs_controller_session_fkey;
ALTER TABLE initiative_runs DROP COLUMN IF EXISTS controller_generation;
DROP TABLE IF EXISTS kernel_controller_sessions;
DELETE FROM schema_version WHERE version = '422';
COMMIT;
