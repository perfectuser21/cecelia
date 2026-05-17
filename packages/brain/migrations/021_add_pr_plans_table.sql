-- Migration 021: Add PR Plans Table (工程规划层)
-- Created: 2026-02-10
-- 目标: 新增 pr_plans 表，实现 Initiative → PR Plans → Task 三层拆解

-- ============================================================
-- Step 1: 创建 pr_plans 表
-- ============================================================

CREATE TABLE IF NOT EXISTS pr_plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    initiative_id uuid NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title varchar(255) NOT NULL,
    description text,
    dod text NOT NULL,  -- Definition of Done（完成定义）
    files text[],       -- 预计修改的文件列表
    sequence integer DEFAULT 0,
    depends_on uuid[],  -- 依赖的其他 PR Plans（uuid 数组）
    complexity varchar(20) DEFAULT 'medium' CHECK (complexity IN ('small', 'medium', 'large')),
    estimated_hours integer,
    status varchar(50) DEFAULT 'planning' CHECK (status IN ('planning', 'in_progress', 'completed', 'cancelled')),
    metadata jsonb DEFAULT '{}',
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_pr_plans_initiative ON pr_plans(initiative_id);
CREATE INDEX IF NOT EXISTS idx_pr_plans_project ON pr_plans(project_id);
CREATE INDEX IF NOT EXISTS idx_pr_plans_status ON pr_plans(status);
CREATE INDEX IF NOT EXISTS idx_pr_plans_sequence ON pr_plans(initiative_id, sequence);

-- 注释
COMMENT ON TABLE pr_plans IS '
PR 规划表（工程拆解层 - Layer 2）。
将 Initiative 拆解为具体的 PR，每个 PR Plan 对应 1 个 Task。
支持依赖关系（depends_on）和执行顺序（sequence）。
';

COMMENT ON COLUMN pr_plans.initiative_id IS '归属的 Initiative（战略方向）';
COMMENT ON COLUMN pr_plans.project_id IS '目标 repository（哪个 repo 的 PR）';
COMMENT ON COLUMN pr_plans.dod IS 'Definition of Done（完成定义），必填';
COMMENT ON COLUMN pr_plans.files IS '预计修改的文件列表（帮助 AI 估算范围）';
COMMENT ON COLUMN pr_plans.sequence IS '执行顺序（1, 2, 3...）';
COMMENT ON COLUMN pr_plans.depends_on IS '依赖的其他 PR Plans（必须先完成的 PR）';
COMMENT ON COLUMN pr_plans.complexity IS '复杂度：small (<2h), medium (2-5h), large (>5h)';

-- ============================================================
-- Step 2: Tasks 表新增 pr_plan_id
-- ============================================================

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pr_plan_id uuid REFERENCES pr_plans(id);

CREATE INDEX IF NOT EXISTS idx_tasks_pr_plan ON tasks(pr_plan_id);

COMMENT ON COLUMN tasks.pr_plan_id IS '
关联的 PR Plan（1 PR Plan = 1 Task）。
如果 Task 通过 PR Plan 创建，此字段必填。
';

-- ============================================================
-- Step 3: 一致性约束
-- ============================================================

-- Task 的 project_id 必须与 PR Plan 的 project_id 一致
CREATE OR REPLACE FUNCTION check_task_pr_plan_consistency()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.pr_plan_id IS NOT NULL THEN
        -- 检查 project_id 一致性
        IF NOT EXISTS (
            SELECT 1 FROM pr_plans
            WHERE id = NEW.pr_plan_id AND project_id = NEW.project_id
        ) THEN
            RAISE EXCEPTION 'Task project_id must match PR Plan project_id';
        END IF;

        -- 检查 initiative_id 一致性（如果 Task 有 initiative_id）
        IF NEW.initiative_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM pr_plans
            WHERE id = NEW.pr_plan_id AND initiative_id = NEW.initiative_id
        ) THEN
            RAISE EXCEPTION 'Task initiative_id must match PR Plan initiative_id';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_task_pr_plan_consistency
    BEFORE INSERT OR UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION check_task_pr_plan_consistency();

COMMENT ON FUNCTION check_task_pr_plan_consistency IS '
确保 Task 的 project_id 和 initiative_id 与关联的 PR Plan 一致。
防止错误的关联关系。
';

-- ============================================================
-- Step 4: 辅助视图
-- ============================================================

-- 视图 1: PR Plans 的完整上下文
CREATE OR REPLACE VIEW pr_plan_full_context AS
SELECT
    pp.id AS pr_plan_id,
    pp.title AS pr_plan_title,
    pp.dod,
    pp.files,
    pp.sequence,
    pp.complexity,
    pp.status AS pr_plan_status,
    -- Initiative 信息
    i.id AS initiative_id,
    i.title AS initiative_title,
    -- Project 信息
    p.id AS project_id,
    p.name AS project_name,
    p.repo_path,
    -- 依赖关系
    pp.depends_on,
    -- 关联的 Task
    t.id AS task_id,
    t.status AS task_status
FROM pr_plans pp
LEFT JOIN features i ON pp.initiative_id = i.id
LEFT JOIN projects p ON pp.project_id = p.id
LEFT JOIN tasks t ON t.pr_plan_id = pp.id;

COMMENT ON VIEW pr_plan_full_context IS '
PR Plan 的完整上下文视图。
包含 Initiative、Project、Task 信息，便于查询和展示。
';

-- 视图 2: Initiative 的 PR 规划进度
CREATE OR REPLACE VIEW initiative_pr_progress AS
SELECT
    i.id AS initiative_id,
    i.title AS initiative_title,
    COUNT(pp.id) AS total_prs,
    COUNT(CASE WHEN pp.status = 'completed' THEN 1 END) AS completed_prs,
    COUNT(CASE WHEN pp.status = 'in_progress' THEN 1 END) AS in_progress_prs,
    COUNT(CASE WHEN pp.status = 'planning' THEN 1 END) AS planning_prs,
    CASE
        WHEN COUNT(pp.id) = 0 THEN 0
        ELSE ROUND(100.0 * COUNT(CASE WHEN pp.status = 'completed' THEN 1 END) / COUNT(pp.id))
    END AS progress_percentage
FROM features i
LEFT JOIN pr_plans pp ON i.id = pp.initiative_id
GROUP BY i.id, i.title;

COMMENT ON VIEW initiative_pr_progress IS '
Initiative 的 PR 规划进度统计。
用于 Dashboard 展示和调度决策。
';

-- ============================================================
-- Step 5: 更新 schema_version
-- ============================================================

INSERT INTO schema_version (version, description, applied_at)
VALUES ('021', 'Add pr_plans table for Layer 2 decomposition', now())
ON CONFLICT (version) DO NOTHING;

-- ============================================================
-- 验证
-- ============================================================

DO $$
DECLARE
    pr_plans_cnt integer;
    tasks_with_pr_plan integer;
BEGIN
    SELECT COUNT(*) INTO pr_plans_cnt FROM pr_plans;
    SELECT COUNT(*) INTO tasks_with_pr_plan FROM tasks WHERE pr_plan_id IS NOT NULL;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 021 完成 ✅';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'pr_plans 表已创建，当前 % 条记录', pr_plans_cnt;
    RAISE NOTICE 'tasks 表已添加 pr_plan_id，当前 % 条任务关联 PR Plan', tasks_with_pr_plan;
    RAISE NOTICE '========================================';
    RAISE NOTICE '新的三层拆解体系：';
    RAISE NOTICE '  Layer 1: Initiative (features 表)';
    RAISE NOTICE '  Layer 2: PR Plans (pr_plans 表) ⭐ 新增';
    RAISE NOTICE '  Layer 3: Tasks (tasks 表)';
    RAISE NOTICE '========================================';
END $$;
