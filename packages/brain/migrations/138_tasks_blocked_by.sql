-- Migration 138: tasks 表新增 blocked_by 字段
-- 补充 Migration 137 (blocked_at/blocked_reason/blocked_until) 中未包含的字段
-- blocked_by: 阻塞来源标识（如 dependency:<task_id>、resource:memory、error:ci_failure、api）

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS blocked_by TEXT;

-- 记录 migration 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('138', 'tasks 表新增 blocked_by 字段', NOW())
ON CONFLICT (version) DO NOTHING;
