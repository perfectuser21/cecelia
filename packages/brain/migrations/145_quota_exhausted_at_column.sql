-- Migration 145: tasks 表补充 quota_exhausted_at 时间戳字段 + CHECK 约束
-- 背景：migration 144 已创建 quota_exhausted 索引，本次补充：
--   1. quota_exhausted_at TIMESTAMPTZ — 记录配额耗尽发生时间，供配额恢复计划使用
--   2. CHECK 约束 — status='quota_exhausted' 时 quota_exhausted_at 不为空
--   3. 修正索引列 — 144 的索引建在 created_at，本次改建在 quota_exhausted_at

-- 添加 quota_exhausted_at 字段
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS quota_exhausted_at TIMESTAMPTZ;

-- CHECK 约束：status = 'quota_exhausted' 时 quota_exhausted_at 不为空
ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS chk_quota_exhausted_at;

ALTER TABLE tasks
  ADD CONSTRAINT chk_quota_exhausted_at
  CHECK (status != 'quota_exhausted' OR quota_exhausted_at IS NOT NULL);

-- 修正索引：重建为按 quota_exhausted_at 扫描（原 144 的索引按 created_at，语义不对）
DROP INDEX IF EXISTS idx_tasks_quota_exhausted;

CREATE INDEX IF NOT EXISTS idx_tasks_quota_exhausted
  ON tasks (quota_exhausted_at)
  WHERE status = 'quota_exhausted';

-- 记录 migration 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('145', 'tasks quota_exhausted_at 字段 + CHECK 约束 + 修正索引', NOW())
ON CONFLICT (version) DO NOTHING;
