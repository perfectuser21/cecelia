-- Rollback for migration 416（手动执行：psql -f，不被 migrate.js 自动发现）
-- 历史空白 session 已归一为 NULL，该数据清理不可逆；回滚只移除
-- 新写入约束，保留 NULL=无主的安全语义。

ALTER TABLE initiative_runs
  DROP CONSTRAINT IF EXISTS initiative_runs_controller_session_nonblank_check;

DELETE FROM schema_version WHERE version = '416';
