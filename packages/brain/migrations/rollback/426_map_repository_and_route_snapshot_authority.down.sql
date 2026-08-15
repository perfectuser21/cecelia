BEGIN;

ALTER TABLE work_routing_receipts
  DROP CONSTRAINT IF EXISTS work_routing_receipts_profile_shape_strength_check;
ALTER TABLE work_routing_receipts
  DROP CONSTRAINT IF EXISTS work_routing_receipts_map_scope_validation_version_check;
ALTER TABLE work_routing_receipts
  DROP COLUMN IF EXISTS map_scope_validation_version;
DROP INDEX IF EXISTS uq_map_scope_repositories_repo;
DELETE FROM schema_version WHERE version = '426';

COMMIT;
