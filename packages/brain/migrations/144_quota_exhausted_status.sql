-- Migration 144: tasks 表新增 quota_exhausted 状态
-- 背景：配额耗尽的任务当前被标记为 failed，导致 failure_count 增加，
--       最终触发隔离，污染失败率指标。
--       新增独立状态 quota_exhausted 使其不计入失败阈值。
--
-- 状态语义：
--   quota_exhausted — 任务因 API 配额耗尽而终止，不是任务本身的失败。
--                     不增加 failure_count，不触发隔离。
--                     可在配额恢复后重新 requeue。

-- 索引：供配额管理快速扫描待恢复任务
CREATE INDEX IF NOT EXISTS idx_tasks_quota_exhausted
  ON tasks (created_at)
  WHERE status = 'quota_exhausted';

-- 记录 migration 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('144', 'tasks quota_exhausted 状态 + 索引', NOW())
ON CONFLICT (version) DO NOTHING;
