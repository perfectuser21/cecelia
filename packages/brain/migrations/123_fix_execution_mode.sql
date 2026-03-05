-- Migration 123: Fix execution_mode values
--
-- Root cause: actions.js defaulted to 'simple', task-router.js defaulted to 'single'.
-- Both values are not recognized by planNextTask() which only accepts 'cecelia' or NULL.
-- This caused ALL initiatives to be invisible to planNextTask, and initiative-closer
-- never closed active initiatives, resulting in 0% KR progress despite completed tasks.
--
-- Fix 1: Normalize execution_mode in projects table
UPDATE projects
SET execution_mode = 'cecelia'
WHERE execution_mode IN ('simple', 'single')
  AND type IN ('initiative', 'project');

-- Fix 2: Clear goal_id for queued tasks whose goal is cancelled
-- (keeps tasks alive but removes cancelled KR scope filter from dispatch)
UPDATE tasks
SET goal_id = NULL,
    updated_at = NOW()
WHERE status = 'queued'
  AND goal_id IN (
    SELECT id FROM goals WHERE status = 'cancelled'
  );
