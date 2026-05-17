-- Cecelia Architecture Upgrade Migration
-- Created: 2026-02-04
-- PRD: .prd-cecelia-architecture-upgrade.md

-- 1. tasks 表：添加 task_type 字段
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS task_type VARCHAR(20) DEFAULT 'dev';

-- 添加约束（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tasks_task_type_check'
    ) THEN
        ALTER TABLE tasks
        ADD CONSTRAINT tasks_task_type_check
        CHECK (task_type IN ('dev', 'automation', 'qa', 'audit', 'research'));
    END IF;
END $$;

-- 2. goals 表：更新状态约束
-- 先删除旧约束（如果存在）
ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_status_check;

-- 添加新约束
ALTER TABLE goals
ADD CONSTRAINT goals_status_check
CHECK (status IN (
    'pending',      -- 初始
    'needs_info',   -- 等待补充信息
    'ready',        -- 信息完整，可拆解
    'decomposing',  -- 正在拆解
    'in_progress',  -- 进行中
    'completed',    -- 完成
    'cancelled'     -- 取消
));

-- 3. projects 表：添加 lead_agent 字段
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS lead_agent VARCHAR(100);

-- 4. daily_logs 表：添加字段
ALTER TABLE daily_logs
ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);

ALTER TABLE daily_logs
ADD COLUMN IF NOT EXISTS agent VARCHAR(100);

ALTER TABLE daily_logs
ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'repo';

-- 添加 type 约束
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'daily_logs_type_check'
    ) THEN
        ALTER TABLE daily_logs
        ADD CONSTRAINT daily_logs_type_check
        CHECK (type IN ('repo', 'summary'));
    END IF;
END $$;

-- 5. 创建 reflections 表（合并 learnings + incidents）
CREATE TABLE IF NOT EXISTS reflections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(20) NOT NULL CHECK (type IN ('issue', 'learning', 'improvement')),
    project_id UUID REFERENCES projects(id),
    source_task_id UUID REFERENCES tasks(id),
    source_goal_id UUID REFERENCES goals(id),
    title VARCHAR(200) NOT NULL,
    content TEXT,
    tags TEXT[],
    created_at TIMESTAMP DEFAULT now()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_reflections_project ON reflections(project_id);
CREATE INDEX IF NOT EXISTS idx_reflections_type ON reflections(type);
CREATE INDEX IF NOT EXISTS idx_reflections_created ON reflections(created_at);

-- 6. 创建索引优化查询
CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
CREATE INDEX IF NOT EXISTS idx_daily_logs_project ON daily_logs(project_id);

COMMENT ON COLUMN tasks.task_type IS 'Task type for routing: dev/automation/qa/audit/research';
COMMENT ON COLUMN goals.status IS 'OKR status: pending/needs_info/ready/decomposing/in_progress/completed/cancelled';
COMMENT ON COLUMN projects.lead_agent IS 'Department lead agent name';
COMMENT ON TABLE reflections IS 'Merged learnings and incidents table';
