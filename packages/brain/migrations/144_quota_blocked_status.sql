-- Migration 144: tasks 表新增 quota_blocked 状态支持
-- 背景：Anthropic API 配额耗尽时，Tick Loop 盲目派发导致全部失败。
-- 新增 quota_blocked 状态，标记因配额耗尽而阻塞的任务，不计入 failure_count。

-- 1. 添加 quota_blocked_at 字段（记录任务进入 quota_blocked 状态的时间）
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS quota_blocked_at TIMESTAMPTZ;

-- 2. 索引：快速查询所有 quota_blocked 状态的任务
CREATE INDEX IF NOT EXISTS idx_tasks_quota_blocked
  ON tasks (status, quota_blocked_at)
  WHERE status = 'quota_blocked';

-- 3. 记录 migration 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('144', 'tasks quota_blocked 状态支持 + quota_blocked_at 字段', NOW())
ON CONFLICT (version) DO NOTHING;
