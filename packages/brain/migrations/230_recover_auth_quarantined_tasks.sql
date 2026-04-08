-- Migration 230: 恢复因 auth 失败被隔离的业务任务
-- 背景：2026-04-07 account3 OAuth token 过期，导致 168 次 auth 失败级联 quarantine
--       token 已于 2026-04-08 06:00 刷新，但 recoverAuthQuarantinedTasks（30min tick）
--       尚未运行（Brain 运行旧代码）。本 migration 直接重排队符合条件的任务。
-- 条件：
--   1. status = quarantined
--   2. failure_class = 'auth'
--   3. task_type NOT IN ('pipeline_rescue')  — pipeline_rescue 为旧 worktree，不恢复
--   4. 同名任务未在 queued/in_progress 中（唯一约束防冲突）
--   5. updated_at 在 48h 内（避免影响更早的遗留任务）
-- 注：不使用 retry_count/max_retries（该列在 CI 新 DB 上可能不存在）

-- 用 CTE 确保每个（title, goal_id, project_id）组合只选一个代表行（最新的），
-- 防止多个同名 quarantined 任务同时更新为 queued 时触发唯一约束冲突。
WITH candidates AS (
  SELECT DISTINCT ON (
    title,
    COALESCE(goal_id,    '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) id
  FROM tasks
  WHERE status = 'quarantined'
    AND payload->>'failure_class' = 'auth'
    AND task_type != 'pipeline_rescue'
    AND updated_at > NOW() - INTERVAL '48 hours'
    -- 排除同名任务已在 queued/in_progress 的情况（避免唯一约束冲突）
    AND NOT EXISTS (
      SELECT 1 FROM tasks dup
      WHERE dup.title = tasks.title
        AND dup.status IN ('queued', 'in_progress')
        AND COALESCE(dup.goal_id,    '00000000-0000-0000-0000-000000000000'::uuid)
            = COALESCE(tasks.goal_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND COALESCE(dup.project_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = COALESCE(tasks.project_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
  ORDER BY
    title,
    COALESCE(goal_id,    '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    updated_at DESC
)
UPDATE tasks t
SET
  status     = 'queued',
  payload    = (COALESCE(t.payload, '{}'::jsonb) - 'failure_class')
               || '{"recovery_source":"migration_230_auth_recover"}'::jsonb,
  updated_at = NOW()
FROM candidates
WHERE t.id = candidates.id;
