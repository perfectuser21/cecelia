-- Migration 142: tasks 表添加 error_message TEXT 字段
-- 存储任务执行失败时的错误信息，供 Cortex 反思和 RCA 使用

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS error_message TEXT;

-- 索引：按失败状态快速查找有错误信息的任务
CREATE INDEX IF NOT EXISTS idx_tasks_error_message_not_null
  ON tasks (status)
  WHERE error_message IS NOT NULL;

-- 记录 migration 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('142', 'tasks error_message TEXT 字段', NOW())
ON CONFLICT (version) DO NOTHING;
