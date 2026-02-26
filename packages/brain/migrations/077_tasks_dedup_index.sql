-- 077: Partial unique index for task deduplication
-- Prevents concurrent creation of duplicate tasks with same title + goal_id + project_id
-- COALESCE handles NULL values (PostgreSQL UNIQUE treats NULLs as distinct)
-- Only applies to active tasks (queued/in_progress)

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_dedup_active
ON tasks (
  title,
  COALESCE(goal_id, '00000000-0000-0000-0000-000000000000'),
  COALESCE(project_id, '00000000-0000-0000-0000-000000000000')
)
WHERE status IN ('queued', 'in_progress');
