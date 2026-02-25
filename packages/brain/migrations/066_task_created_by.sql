-- Migration 066: tasks.created_by + tasks.dept
--
-- 功能：记录任务来源（谁创建的）和所属部门
-- created_by 值：'human' | 'repo-lead:zenithjoy' | 'cecelia-brain'
-- dept 值：'zenithjoy' | 'creator' | NULL（老任务或非部门任务）

-- ============================================================
-- 1. Add created_by column
-- ============================================================
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by TEXT;

-- ============================================================
-- 2. Add dept column
-- ============================================================
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS dept TEXT;

-- ============================================================
-- 3. Index for querying by dept / created_by
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks (created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_dept ON tasks (dept);

-- ============================================================
-- 4. Update schema version
-- ============================================================
INSERT INTO schema_version (version, description)
VALUES ('066', 'tasks.created_by / tasks.dept - 部门任务来源标记')
ON CONFLICT (version) DO NOTHING;
