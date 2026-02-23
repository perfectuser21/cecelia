-- Migration 058: Drop pr_plans table and related objects
-- Created: 2026-02-23
-- 目标: 清理旧的三层拆解架构（pr_plans），替换为 Initiative 4-Phase 编排

-- ============================================================
-- Step 1: 删除视图（依赖 pr_plans 表和 tasks.pr_plan_id）
-- 必须在删除表和列之前执行
-- ============================================================

DROP VIEW IF EXISTS pr_plan_full_context;
DROP VIEW IF EXISTS initiative_pr_progress;

-- ============================================================
-- Step 2: 删除触发器和函数
-- ============================================================

DROP TRIGGER IF EXISTS ensure_task_pr_plan_consistency ON tasks;
DROP FUNCTION IF EXISTS check_task_pr_plan_consistency();

-- ============================================================
-- Step 3: 删除 tasks.pr_plan_id 外键和列
-- ============================================================

DROP INDEX IF EXISTS idx_tasks_pr_plan;
ALTER TABLE tasks DROP COLUMN IF EXISTS pr_plan_id;

-- ============================================================
-- Step 4: 删除 pr_plans 表
-- ============================================================

DROP TABLE IF EXISTS pr_plans CASCADE;

-- ============================================================
-- Step 5: 更新 schema_version
-- ============================================================

INSERT INTO schema_version (version, description, applied_at)
VALUES ('058', 'Drop pr_plans table and related objects', now())
ON CONFLICT (version) DO NOTHING;

-- ============================================================
-- 验证
-- ============================================================

DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 058 完成';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'pr_plans 表已删除';
    RAISE NOTICE 'tasks.pr_plan_id 列已删除';
    RAISE NOTICE 'pr_plan_full_context 视图已删除';
    RAISE NOTICE 'initiative_pr_progress 视图已删除';
    RAISE NOTICE 'check_task_pr_plan_consistency 触发器已删除';
    RAISE NOTICE '========================================';
END $$;
