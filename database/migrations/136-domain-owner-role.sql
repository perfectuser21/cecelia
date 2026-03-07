-- Migration 134: Add domain and owner_role to tasks, goals, projects
-- Implements Stage 0.5 domain detection from /plan SKILL.md

-- ============================================================
-- 1. tasks 表添加 domain 和 owner_role 字段
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS domain VARCHAR(50),
  ADD COLUMN IF NOT EXISTS owner_role VARCHAR(50);

-- ============================================================
-- 2. goals 表添加 domain 和 owner_role 字段
-- ============================================================

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS domain VARCHAR(50),
  ADD COLUMN IF NOT EXISTS owner_role VARCHAR(50);

-- ============================================================
-- 3. projects 表添加 domain 和 owner_role 字段
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS domain VARCHAR(50),
  ADD COLUMN IF NOT EXISTS owner_role VARCHAR(50);

-- ============================================================
-- 4. 索引（提高按 domain 过滤性能）
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_tasks_domain ON tasks(domain);
CREATE INDEX IF NOT EXISTS idx_goals_domain ON goals(domain);
CREATE INDEX IF NOT EXISTS idx_projects_domain ON projects(domain);

-- ============================================================
-- 5. 更新 schema_version
-- ============================================================

INSERT INTO schema_version (version, applied_at)
VALUES ('136', NOW())
ON CONFLICT (version) DO NOTHING;
