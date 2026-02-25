-- ⚠️  ROLLBACK SCRIPT — DO NOT APPLY IN NORMAL MIGRATION SEQUENCE
-- ⚠️  This script undoes 057_initiative_orchestration.sql
-- ⚠️  Only apply if you intend to REMOVE the initiative orchestration feature.
-- ⚠️  Current codebase (task-router.js) uses initiative_plan/initiative_verify.
--     Applying this will break the system unless the code is also rolled back.
--
-- Archived from: 060_rollback_initiative_orchestration.sql (was duplicate 060)
-- Date: 2026-02-23

-- 安全处理：先将 initiative_plan/initiative_verify 改为 exploratory (避免 CHECK 冲突)
UPDATE tasks SET task_type = 'exploratory'
WHERE task_type IN ('initiative_plan', 'initiative_verify');

-- 清理 projects 表残留列
ALTER TABLE projects DROP COLUMN IF EXISTS execution_mode;
ALTER TABLE projects DROP COLUMN IF EXISTS current_phase;
ALTER TABLE projects DROP COLUMN IF EXISTS dod_content;

-- 清理 tasks.task_type CHECK (移除 initiative_plan, initiative_verify)
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type IN ('dev','review','talk','data','research','exploratory',
    'qa','audit','decomp_review','codex_qa')
);

-- 清理残留索引
DROP INDEX IF EXISTS idx_projects_execution_mode;
DROP INDEX IF EXISTS idx_projects_current_phase;
