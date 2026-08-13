BEGIN;

ALTER TABLE golden_paths DROP CONSTRAINT IF EXISTS golden_paths_map_scope_check;
ALTER TABLE golden_paths DROP CONSTRAINT IF EXISTS golden_paths_change_kind_check;
ALTER TABLE golden_paths DROP COLUMN IF EXISTS map_scope;
ALTER TABLE golden_paths DROP COLUMN IF EXISTS change_kind;

DELETE FROM schema_version WHERE version = '414';

COMMIT;
