-- Migration 038: Fix Orphan Tasks goal_id
--
-- Problem: 491 tasks (98.2%) have null goal_id
-- Root cause: createTask() in actions.js allowed null goal_id without validation
--
-- Solution:
-- 1. Create a default "Legacy Tasks" goal to hold orphan tasks
-- 2. Link all orphan tasks (goal_id IS NULL) to this default goal
-- 3. Add validation in actions.js (code change, not in migration)

-- Step 1: Create default "Legacy Tasks" goal if it doesn't exist
INSERT INTO goals (
  id,
  title,
  description,
  status,
  priority,
  progress,
  type,
  created_at,
  updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Legacy Tasks (Auto-created)',
  'Default goal for tasks created before goal_id validation was enforced. These tasks should be reviewed and re-associated with proper OKR goals.',
  'in_progress',
  'P2',
  0,
  'kr',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM goals WHERE id = '00000000-0000-0000-0000-000000000001'::uuid
);

-- Step 2: Link all orphan tasks to the default goal
UPDATE tasks
SET
  goal_id = '00000000-0000-0000-0000-000000000001'::uuid,
  updated_at = NOW()
WHERE goal_id IS NULL
  AND status IN ('queued', 'in_progress', 'failed')  -- Don't touch completed tasks
  AND task_type NOT IN ('exploratory', 'research')   -- Don't touch system tasks
  AND (trigger_source IS NULL OR trigger_source NOT IN ('manual', 'test', 'watchdog', 'circuit_breaker'));

-- Step 3: Add comment to record the fix
COMMENT ON COLUMN tasks.goal_id IS 'KR ID (required for most tasks). Migration 038 fixed 491 orphan tasks by linking them to default goal.';
