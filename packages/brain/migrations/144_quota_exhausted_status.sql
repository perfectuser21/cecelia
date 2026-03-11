-- Migration 144: tasks 表新增 quota_exhausted 独立状态
-- 背景：配额耗尽时任务被错误标记为 failed，计入 failure_count 并触发隔离。
-- 需要独立状态区分"业务失败"和"资源限制（配额耗尽）"。

-- 添加 quota_exhausted_at 字段（记录配额耗尽发生时间）
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS quota_exhausted_at TIMESTAMPTZ;

-- CHECK 约束：status = 'quota_exhausted' 时 quota_exhausted_at 不为空
ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS chk_quota_exhausted_at;

ALTER TABLE tasks
  ADD CONSTRAINT chk_quota_exhausted_at
  CHECK (status != 'quota_exhausted' OR quota_exhausted_at IS NOT NULL);

-- 索引：供 Planner 快速扫描 quota_exhausted 状态的任务（配额恢复后重新排队）
CREATE INDEX IF NOT EXISTS idx_tasks_quota_exhausted
  ON tasks (quota_exhausted_at)
  WHERE status = 'quota_exhausted';

-- 记录 migration 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('144', 'tasks quota_exhausted 状态字段 + CHECK 约束 + 索引', NOW())
ON CONFLICT (version) DO NOTHING;
