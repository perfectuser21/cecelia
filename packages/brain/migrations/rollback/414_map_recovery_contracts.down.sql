-- Rollback migration 414
DROP TABLE IF EXISTS map_recovery_contracts CASCADE;
DELETE FROM schema_version WHERE version = '414';
