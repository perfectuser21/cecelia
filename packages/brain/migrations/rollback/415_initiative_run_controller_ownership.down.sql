-- Rollback for migration 415（仅供受控回滚，不被 migrate.js 自动发现）

ALTER TABLE initiative_runs DROP COLUMN IF EXISTS controller_session_id;
ALTER TABLE initiative_runs DROP COLUMN IF EXISTS controller_lease_expires_at;

DELETE FROM schema_version WHERE version = '415';
