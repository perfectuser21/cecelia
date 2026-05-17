-- Migration 221: tasks 表新增 sprint_dir 列
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sprint_dir text;
CREATE INDEX IF NOT EXISTS idx_tasks_sprint_dir ON tasks (sprint_dir);
INSERT INTO schema_version (version, description, applied_at)
VALUES ('221', 'tasks 表新增 sprint_dir 列用于 Harness sprint 过滤', NOW())
ON CONFLICT (version) DO NOTHING;
