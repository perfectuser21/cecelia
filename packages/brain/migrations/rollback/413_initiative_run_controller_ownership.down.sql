-- Rollback for migration 413（手动执行：psql -f，不被 migrate.js 自动发现）
-- 完全可逆：controller_session_id / controller_lease_expires_at 均为新增可空列，
-- 无回填、无换绑、无存量行依赖其取值。回滚后 Kernel Run 退回「无 Controller ownership」
-- 语义（= 413 之前的现状），不是丢失业务事实。

ALTER TABLE initiative_runs DROP COLUMN IF EXISTS controller_session_id;
ALTER TABLE initiative_runs DROP COLUMN IF EXISTS controller_lease_expires_at;

DELETE FROM schema_version WHERE version = '413';
