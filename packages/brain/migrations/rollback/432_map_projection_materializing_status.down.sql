-- Rollback 432: 收回 map_projection_runs.status 的 'materializing' 放开。
-- 前置：回滚前须确保无 status='materializing' 残行（否则收窄 CHECK 会失败）。
--   DELETE FROM map_projection_runs WHERE status = 'materializing';

ALTER TABLE map_projection_runs
  DROP CONSTRAINT IF EXISTS map_projection_runs_status_check;

ALTER TABLE map_projection_runs
  ADD CONSTRAINT map_projection_runs_status_check
  CHECK (status IN ('building', 'active', 'superseded', 'failed'));

ALTER TABLE map_projection_runs
  DROP CONSTRAINT IF EXISTS map_projection_run_activation_shape;

ALTER TABLE map_projection_runs
  ADD CONSTRAINT map_projection_run_activation_shape CHECK (
    (status IN ('active', 'superseded') AND activated_at IS NOT NULL)
    OR (status IN ('building', 'failed') AND activated_at IS NULL)
  );

DELETE FROM schema_version WHERE version = '432';
