-- Migration 089: Goal Evaluations outer loop
-- 记录 Brain 对每个 KR/Goal 的整体进展评估结果
-- Magentic-One outer loop：定期评估目标是否在轨，必要时触发重新规划

CREATE TABLE IF NOT EXISTS goal_evaluations (
    id BIGSERIAL PRIMARY KEY,
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,

    -- 评估结论
    verdict VARCHAR(20) NOT NULL, -- 'on_track' | 'needs_attention' | 'stalled'

    -- 评估指标（快照）
    metrics JSONB DEFAULT '{}',
    -- 包含：
    --   task_completion_rate: DECIMAL  最近7天 completed/total 任务比率
    --   recent_failures: INT           最近7天失败任务数
    --   days_since_last_progress: INT  距离上次有任务完成的天数
    --   total_tasks_7d: INT            最近7天总任务数
    --   completed_tasks_7d: INT        最近7天完成任务数

    -- 触发的行动
    action_taken VARCHAR(50) DEFAULT 'none',
    -- 'none' | 'suggestion_created' | 'initiative_plan_created'

    action_detail JSONB DEFAULT '{}',
    -- 触发行动的详情，如创建的 task_id

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_goal_evaluations_goal_id ON goal_evaluations(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_evaluations_verdict ON goal_evaluations(verdict);
CREATE INDEX IF NOT EXISTS idx_goal_evaluations_created_at ON goal_evaluations(created_at);

-- 视图：每个 goal 的最新评估
CREATE OR REPLACE VIEW v_latest_goal_evaluation AS
SELECT DISTINCT ON (goal_id)
    ge.*,
    g.title as goal_title,
    g.status as goal_status,
    g.priority as goal_priority,
    g.progress as goal_progress
FROM goal_evaluations ge
JOIN goals g ON g.id = ge.goal_id
ORDER BY goal_id, created_at DESC;

