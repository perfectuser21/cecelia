-- Migration 144: tasks 表新增 quota_exhausted 状态（配额耗尽）
-- 配额耗尽的任务标记为 quota_exhausted 而非 failed：
--   1. 不递增 failure_count（不污染失败指标）
--   2. 不触发隔离（节省人工审查成本）
--   3. 等待配额重置后由轮转机制重新派发

-- tasks.status 是 VARCHAR(50)，无全局枚举约束，直接新增注释文档
COMMENT ON COLUMN tasks.status IS
  'Task status: queued, in_progress, completed, failed, quarantined, cancelled, blocked, completed_no_pr, quota_exhausted';

-- 记录 migration 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('144', 'tasks quota_exhausted 状态（配额耗尽，不计入失败次数，不触发隔离）', NOW())
ON CONFLICT (version) DO NOTHING;
