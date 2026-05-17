-- Migration 032: Exploratory → Dev flow + Recurring Tasks Enhancement
-- Date: 2026-02-15
--
-- Changes:
-- 1. Add 'phase' column to tasks (exploratory/dev)
-- 2. Fix task_type constraint to include 'exploratory'
-- 3. Enhance recurring_tasks table with goal_id, project_id, worker_type, recurrence_type

BEGIN;

-- ============================================================
-- 1. Tasks: Add 'phase' column for exploratory → dev flow
-- ============================================================

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS phase TEXT DEFAULT 'dev';

-- Add constraint for phase values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tasks_phase_check'
    ) THEN
        ALTER TABLE tasks
        ADD CONSTRAINT tasks_phase_check
        CHECK (phase IN ('exploratory', 'dev'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_phase ON tasks(phase);

COMMENT ON COLUMN tasks.phase IS 'Task phase: exploratory (validation/spike) or dev (implementation)';

-- ============================================================
-- 2. Fix task_type constraint to include 'exploratory'
-- ============================================================

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
    task_type IN (
        'dev',          -- 开发：完整代码读写
        'review',       -- 审查：只读代码，输出报告
        'talk',         -- 对话：只写文档，不改代码
        'data',         -- 数据处理：HK N8N workflows
        'automation',   -- N8N：调 API
        'research',     -- 研究：完全只读
        'exploratory',  -- 探索性验证：Opus
        -- 保留兼容旧类型
        'qa',
        'audit'
    )
);

-- ============================================================
-- 3. Enhance recurring_tasks table
-- ============================================================

ALTER TABLE recurring_tasks ADD COLUMN IF NOT EXISTS goal_id UUID REFERENCES goals(id);
ALTER TABLE recurring_tasks ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);
ALTER TABLE recurring_tasks ADD COLUMN IF NOT EXISTS worker_type TEXT DEFAULT 'claude';
ALTER TABLE recurring_tasks ADD COLUMN IF NOT EXISTS recurrence_type TEXT DEFAULT 'cron';
ALTER TABLE recurring_tasks ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'P1';

-- Add constraint for worker_type
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'recurring_tasks_worker_type_check'
    ) THEN
        ALTER TABLE recurring_tasks
        ADD CONSTRAINT recurring_tasks_worker_type_check
        CHECK (worker_type IN ('claude', 'minimax', 'n8n'));
    END IF;
END $$;

-- Add constraint for recurrence_type
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'recurring_tasks_recurrence_type_check'
    ) THEN
        ALTER TABLE recurring_tasks
        ADD CONSTRAINT recurring_tasks_recurrence_type_check
        CHECK (recurrence_type IN ('cron', 'interval', 'daily', 'weekly'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recurring_tasks_goal ON recurring_tasks(goal_id);
CREATE INDEX IF NOT EXISTS idx_recurring_tasks_project ON recurring_tasks(project_id);

COMMENT ON COLUMN recurring_tasks.goal_id IS 'Associated KR goal for the recurring task';
COMMENT ON COLUMN recurring_tasks.project_id IS 'Associated project/initiative for the recurring task';
COMMENT ON COLUMN recurring_tasks.worker_type IS 'Worker type: claude, minimax, n8n';
COMMENT ON COLUMN recurring_tasks.recurrence_type IS 'Recurrence type: cron, interval, daily, weekly';
COMMENT ON COLUMN recurring_tasks.priority IS 'Default priority for created task instances';

-- ============================================================
-- 4. Record migration
-- ============================================================

INSERT INTO schema_version (version, description) VALUES ('032', 'exploratory_dev_flow_and_recurring')
ON CONFLICT (version) DO NOTHING;

COMMIT;
