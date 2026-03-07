-- Migration 134: tasks.domain + tasks.owner_role
-- Stage 0.5 领域判断：记录任务所属领域及负责人角色

-- 1. Add domain column
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS domain VARCHAR(50);

-- 2. Add owner_role column
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS owner_role VARCHAR(50);

-- 3. Index for querying by domain / owner_role
CREATE INDEX IF NOT EXISTS idx_tasks_domain ON tasks (domain);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_role ON tasks (owner_role);

-- 4. Register migration
INSERT INTO schema_version (version, description)
VALUES ('134', 'tasks.domain / tasks.owner_role - Stage 0.5 领域判断')
ON CONFLICT (version) DO NOTHING;
