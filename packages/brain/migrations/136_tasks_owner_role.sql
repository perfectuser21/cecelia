-- Migration 136: tasks.owner_role + domain/owner_role 查询索引
-- Migration 134 已添加 tasks.domain，本次补充 tasks.owner_role 及索引
-- Stage 0.5 领域判断：记录任务负责人角色，配合 detectDomain() 自动派发

-- 1. Add owner_role column（tasks.domain 已由 migration 134 添加）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS owner_role VARCHAR(50);

-- 2. Index for querying tasks by domain / owner_role
CREATE INDEX IF NOT EXISTS idx_tasks_domain ON tasks (domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_owner_role ON tasks (owner_role) WHERE owner_role IS NOT NULL;

-- 3. Register migration
INSERT INTO schema_version (version, description)
VALUES ('136', 'tasks.owner_role + domain/owner_role 查询索引 - Stage 0.5 领域判断')
ON CONFLICT (version) DO NOTHING;
