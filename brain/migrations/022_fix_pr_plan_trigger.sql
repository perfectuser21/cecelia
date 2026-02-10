-- Migration 022: Fix check_task_pr_plan_consistency trigger
-- Created: 2026-02-10
-- 目标: Fix trigger to not reference non-existent initiative_id column in tasks table

-- ============================================================
-- Step 1: Drop and recreate trigger function
-- ============================================================

-- Drop existing trigger first
DROP TRIGGER IF EXISTS ensure_task_pr_plan_consistency ON tasks;

-- Recreate function without initiative_id check
CREATE OR REPLACE FUNCTION check_task_pr_plan_consistency()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.pr_plan_id IS NOT NULL THEN
        -- Check project_id consistency only
        -- (tasks table does not have initiative_id column)
        IF NOT EXISTS (
            SELECT 1 FROM pr_plans
            WHERE id = NEW.pr_plan_id AND project_id = NEW.project_id
        ) THEN
            RAISE EXCEPTION 'Task project_id must match PR Plan project_id';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger
CREATE TRIGGER ensure_task_pr_plan_consistency
    BEFORE INSERT OR UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION check_task_pr_plan_consistency();

COMMENT ON FUNCTION check_task_pr_plan_consistency IS '
Ensure Task project_id matches PR Plan project_id.
Note: initiative_id check removed because tasks table does not have initiative_id column.
';

-- ============================================================
-- Step 2: Update schema_version
-- ============================================================

INSERT INTO schema_version (version, description, applied_at)
VALUES ('022', 'Fix check_task_pr_plan_consistency trigger', now())
ON CONFLICT (version) DO NOTHING;

-- ============================================================
-- Verification
-- ============================================================

DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 022 完成 ✅';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Trigger check_task_pr_plan_consistency has been fixed';
    RAISE NOTICE 'Removed initiative_id check (column does not exist in tasks)';
    RAISE NOTICE '========================================';
END $$;
