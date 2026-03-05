-- Migration: Backfill task goal_id from project_kr_links
-- Date: 2026-03-05
-- Purpose: 修复13个 goal_id 为 null 的已完成任务，通过 project_id 回溯到 KR

-- Step 1: 回填已完成任务的 goal_id（通过 project_id → Initiative → Project → KR）
WITH task_kr_mapping AS (
  SELECT
    t.id AS task_id,
    pkl.kr_id,
    t.title,
    project.name AS project_name
  FROM tasks t
  JOIN projects initiative ON initiative.id = t.project_id AND initiative.type = 'initiative'
  JOIN projects project ON project.id = initiative.parent_id AND project.type = 'project'
  JOIN project_kr_links pkl ON pkl.project_id = project.id
  WHERE t.goal_id IS NULL
    AND t.status = 'completed'
    AND t.created_at >= '2026-03-01'  -- 只回填3月之后的任务，避免影响历史数据
)
UPDATE tasks
SET goal_id = task_kr_mapping.kr_id,
    updated_at = NOW()
FROM task_kr_mapping
WHERE tasks.id = task_kr_mapping.task_id;

-- Step 2: 触发受影响 KR 的进度重新计算
-- 注意：这个 SQL 只是记录受影响的 KR ID，实际进度更新由 Brain API 调用 kr-progress.js 完成
SELECT DISTINCT pkl.kr_id, g.title AS kr_title
FROM tasks t
JOIN projects initiative ON initiative.id = t.project_id AND initiative.type = 'initiative'
JOIN projects project ON project.id = initiative.parent_id AND project.type = 'project'
JOIN project_kr_links pkl ON pkl.project_id = project.id
JOIN goals g ON g.id = pkl.kr_id
WHERE t.goal_id IS NOT NULL
  AND t.status = 'completed'
  AND t.updated_at >= NOW() - INTERVAL '1 minute';  -- 刚刚更新的任务
