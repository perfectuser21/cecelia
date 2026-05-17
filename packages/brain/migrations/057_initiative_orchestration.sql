-- Migration 057: Initiative 4-Phase 编排基础设施
-- Version: 057
-- Date: 2026-02-22
-- Description: projects 新增编排列 + tasks.task_type 扩展

-- projects 表新增 3 列
ALTER TABLE projects ADD COLUMN IF NOT EXISTS execution_mode TEXT DEFAULT 'simple';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_phase TEXT DEFAULT NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS dod_content JSONB DEFAULT NULL;

-- tasks.task_type CHECK 扩展：新增 initiative_plan, initiative_verify
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type IN ('dev','review','talk','data','research','exploratory',
    'qa','audit','decomp_review','codex_qa',
    'initiative_plan','initiative_verify')
);

-- 索引：快速查询 orchestrated initiative
CREATE INDEX IF NOT EXISTS idx_projects_execution_mode
  ON projects(execution_mode) WHERE execution_mode = 'orchestrated';
CREATE INDEX IF NOT EXISTS idx_projects_current_phase
  ON projects(current_phase) WHERE current_phase IS NOT NULL;

-- schema version
INSERT INTO schema_version (version, description)
VALUES ('057', 'Initiative 4-Phase orchestration infrastructure')
ON CONFLICT (version) DO NOTHING;
