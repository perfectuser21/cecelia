-- Feature Tick System Migration
-- Created: 2026-02-05
-- PRD: .prd-feature-tick-system.md

-- 1. 创建 features 表
CREATE TABLE IF NOT EXISTS features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 基本信息
    title TEXT NOT NULL,
    description TEXT,
    prd TEXT,                       -- 大 PRD

    -- 关联
    goal_id UUID REFERENCES goals(id),
    project_id UUID REFERENCES projects(id),

    -- 状态机
    status TEXT NOT NULL DEFAULT 'planning',
    -- planning → task_created → task_running → task_completed → evaluating → completed

    -- 防串线
    active_task_id UUID,            -- 当前活跃的 Task（状态锁）
    current_pr_number INTEGER DEFAULT 0,

    -- 元数据
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 添加 features 状态约束
ALTER TABLE features DROP CONSTRAINT IF EXISTS features_status_check;
ALTER TABLE features
ADD CONSTRAINT features_status_check
CHECK (status IN (
    'planning',         -- 初始状态，等待规划第一个 Task
    'task_created',     -- Task 已创建
    'task_running',     -- Task 正在执行
    'task_completed',   -- Task 完成，等待评估
    'evaluating',       -- 正在评估是否需要下一个 Task
    'completed',        -- Feature 完成
    'cancelled'         -- 取消
));

-- 创建 features 索引
CREATE INDEX IF NOT EXISTS idx_features_status ON features(status);
CREATE INDEX IF NOT EXISTS idx_features_goal ON features(goal_id);
CREATE INDEX IF NOT EXISTS idx_features_project ON features(project_id);

-- 2. tasks 表：添加新字段
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS execution_mode TEXT DEFAULT 'single';
-- single | feature_task | recurring

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS location TEXT DEFAULT 'us';
-- us | hk

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS feature_id UUID REFERENCES features(id);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS artifact_ref TEXT;
-- 产物引用（PR URL、日志路径等）

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS summary TEXT;
-- 结果摘要（回大脑用）

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS quality_gate TEXT DEFAULT 'pending';
-- pass | fail | pending

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS escalation_level TEXT DEFAULT 'none';
-- none | warning | critical

-- 添加 execution_mode 约束
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tasks_execution_mode_check'
    ) THEN
        ALTER TABLE tasks
        ADD CONSTRAINT tasks_execution_mode_check
        CHECK (execution_mode IN ('single', 'feature_task', 'recurring'));
    END IF;
END $$;

-- 添加 location 约束
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tasks_location_check'
    ) THEN
        ALTER TABLE tasks
        ADD CONSTRAINT tasks_location_check
        CHECK (location IN ('us', 'hk'));
    END IF;
END $$;

-- 添加 quality_gate 约束
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tasks_quality_gate_check'
    ) THEN
        ALTER TABLE tasks
        ADD CONSTRAINT tasks_quality_gate_check
        CHECK (quality_gate IN ('pass', 'fail', 'pending'));
    END IF;
END $$;

-- 添加 escalation_level 约束
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tasks_escalation_level_check'
    ) THEN
        ALTER TABLE tasks
        ADD CONSTRAINT tasks_escalation_level_check
        CHECK (escalation_level IN ('none', 'warning', 'critical'));
    END IF;
END $$;

-- 3. 创建 recurring_tasks 表
CREATE TABLE IF NOT EXISTS recurring_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    title TEXT NOT NULL,
    description TEXT,

    task_type TEXT NOT NULL,        -- dev | automation | data
    location TEXT DEFAULT 'us',

    cron_expression TEXT NOT NULL,  -- "0 9 * * *"
    template JSONB,                 -- 任务模板

    is_active BOOLEAN DEFAULT TRUE,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建 recurring_tasks 索引
CREATE INDEX IF NOT EXISTS idx_recurring_tasks_active ON recurring_tasks(is_active);
CREATE INDEX IF NOT EXISTS idx_recurring_tasks_next_run ON recurring_tasks(next_run_at);

-- 4. 创建 tasks 新字段索引
CREATE INDEX IF NOT EXISTS idx_tasks_execution_mode ON tasks(execution_mode);
CREATE INDEX IF NOT EXISTS idx_tasks_location ON tasks(location);
CREATE INDEX IF NOT EXISTS idx_tasks_feature ON tasks(feature_id);
CREATE INDEX IF NOT EXISTS idx_tasks_quality_gate ON tasks(quality_gate);

-- 5. 添加注释
COMMENT ON TABLE features IS 'Feature 表：支持边做边拆的大功能';
COMMENT ON COLUMN features.status IS 'Feature 状态机：planning/task_created/task_running/task_completed/evaluating/completed/cancelled';
COMMENT ON COLUMN features.active_task_id IS '当前活跃的 Task ID（防串线状态锁）';
COMMENT ON COLUMN features.prd IS '大 PRD 文档内容';

COMMENT ON COLUMN tasks.execution_mode IS '执行模式：single（单任务）/feature_task（Feature 子任务）/recurring（循环任务）';
COMMENT ON COLUMN tasks.location IS '执行位置：us（美国 VPS）/hk（香港 VPS）';
COMMENT ON COLUMN tasks.feature_id IS '关联的 Feature ID（如果是 Feature 子任务）';
COMMENT ON COLUMN tasks.summary IS '任务完成摘要（回大脑用）';
COMMENT ON COLUMN tasks.quality_gate IS '质量门状态：pass/fail/pending';
COMMENT ON COLUMN tasks.escalation_level IS '升级级别：none/warning/critical';

COMMENT ON TABLE recurring_tasks IS '循环任务模板表';
