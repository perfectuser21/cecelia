-- Migration 149: 补建 tasks.quota_exhausted_at 字段
-- 背景：migration 145 的版本号与 brain_config quota_reset_at 冲突，
--       导致 quota_exhausted_at 字段从未被创建。
--       execution-callback 端点在 UPDATE tasks 时引用此字段，导致所有
--       agent 任务完成后无法回写结果（Brain degraded 根因）。

-- 补建 quota_exhausted_at 字段
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS quota_exhausted_at TIMESTAMPTZ;

-- CHECK 约束：status = 'quota_exhausted' 时 quota_exhausted_at 不为空
ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS chk_quota_exhausted_at;

ALTER TABLE tasks
  ADD CONSTRAINT chk_quota_exhausted_at
  CHECK (status != 'quota_exhausted' OR quota_exhausted_at IS NOT NULL);

-- 索引：按 quota_exhausted_at 扫描
CREATE INDEX IF NOT EXISTS idx_tasks_quota_exhausted
  ON tasks (quota_exhausted_at)
  WHERE status = 'quota_exhausted';

-- 记录 migration 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('149', 'tasks quota_exhausted_at 字段（补漏 145 版本冲突）', NOW())
ON CONFLICT (version) DO NOTHING;
