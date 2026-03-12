-- Migration 150: tasks 表新增 source_learning_id，用于 insight→task 自动闭合追踪
-- 记录该 task 是由哪条 cortex_insight learning 触发生成的

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source_learning_id UUID;

CREATE INDEX IF NOT EXISTS idx_tasks_source_learning_id
  ON tasks(source_learning_id)
  WHERE source_learning_id IS NOT NULL;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('150', 'tasks: add source_learning_id for insight-to-task traceability', NOW())
ON CONFLICT (version) DO NOTHING;
