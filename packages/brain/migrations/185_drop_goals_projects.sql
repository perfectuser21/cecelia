-- Migration 185: DROP 旧 OKR 表（goals / projects / project_kr_links）
-- 前提：所有生产代码已迁移至新表（okr_projects / key_results / objectives）
-- 执行顺序：
--   1. 迁移 goal_evaluations.goal_id FK 从 goals → key_results（UUID 不变）
--   2. DROP project_kr_links（依赖 goals + projects）
--   3. DROP goals（CASCADE 清理 FK 约束）
--   4. DROP projects（CASCADE 清理 FK 约束）

-- Step 1: 迁移 goal_evaluations.goal_id FK
ALTER TABLE goal_evaluations
  DROP CONSTRAINT IF EXISTS goal_evaluations_goal_id_fkey;

ALTER TABLE goal_evaluations
  ADD CONSTRAINT goal_evaluations_goal_id_fkey
    FOREIGN KEY (goal_id)
    REFERENCES key_results(id)
    ON DELETE CASCADE;

-- Step 2: DROP project_kr_links（依赖 goals + projects，先删）
DROP TABLE IF EXISTS project_kr_links CASCADE;

-- Step 3: DROP goals（CASCADE 同时删除 tasks.goal_id FK、reflections.source_goal_id FK 等）
DROP TABLE IF EXISTS goals CASCADE;

-- Step 4: DROP projects（CASCADE 同时删除 tasks.project_id FK、reflections.project_id FK、daily_logs.project_id FK 等）
DROP TABLE IF EXISTS projects CASCADE;
