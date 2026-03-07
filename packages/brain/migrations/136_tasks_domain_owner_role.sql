-- Migration 136: tasks 表补充 owner_role 字段 + domain/owner_role 索引
-- 配合 migration 134（已添加 goals/projects 的 domain/owner_role，tasks 只添加了 domain）
-- 补充 tasks.owner_role 并为 tasks/projects 添加查询索引

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS owner_role VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_tasks_domain ON tasks (domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_owner_role ON tasks (owner_role) WHERE owner_role IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_domain ON projects (domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_owner_role ON projects (owner_role) WHERE owner_role IS NOT NULL;

INSERT INTO schema_version (version, description)
  VALUES ('136', 'tasks.owner_role 字段 + tasks/projects domain/owner_role 查询索引');
