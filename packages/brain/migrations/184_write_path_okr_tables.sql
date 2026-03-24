-- Migration 184: 写路径切换到新 OKR 表 — 移除旧 FK 约束 + 补充运营列
--
-- 背景：
--   PR9 将 actions.js/planner.js/self-drive.js 等9个文件的写操作
--   从旧 goals/projects 表切换到新 OKR 表（okr_initiatives/okr_scopes/okr_projects 等）。
--   旧 tasks.project_id / tasks.goal_id / project_kr_links / project_repos 有 FK 指向旧表，
--   必须先 DROP 才能让新表 UUID 被引用（新表 UUID 不在旧表中）。
--
-- 操作：
--   1. DROP 旧 FK 约束（tasks.project_id, tasks.goal_id, project_kr_links.*, project_repos.project_id）
--   2. ADD 缺失运营列到 okr_projects（sequence_order / current_phase / time_budget_days）
--   3. schema_version 更新到 184

-- ============================================================
-- 1. tasks 表：DROP project_id 和 goal_id FK
-- ============================================================

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_project_id_fkey;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_goal_id_fkey;

-- ============================================================
-- 2. project_kr_links 表：DROP project_id 和 kr_id FK
-- ============================================================

ALTER TABLE project_kr_links DROP CONSTRAINT IF EXISTS project_kr_links_project_id_fkey;
ALTER TABLE project_kr_links DROP CONSTRAINT IF EXISTS project_kr_links_kr_id_fkey;

-- ============================================================
-- 3. project_repos 表：DROP project_id FK
-- ============================================================

ALTER TABLE project_repos DROP CONSTRAINT IF EXISTS project_repos_project_id_fkey;

-- ============================================================
-- 4. okr_projects 补充运营列
--    self-drive.js adjust_priority 需要 sequence_order
--    self-drive.js update_roadmap 需要 current_phase
--    progress-reviewer.js executePlanAdjustment 需要 time_budget_days
-- ============================================================

ALTER TABLE okr_projects
  ADD COLUMN IF NOT EXISTS sequence_order   INTEGER,
  ADD COLUMN IF NOT EXISTS current_phase    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS time_budget_days INTEGER;

-- ============================================================
-- 5. schema_version
-- ============================================================

INSERT INTO schema_version (version, description, applied_at)
VALUES (
  '184',
  '写路径切换到新 OKR 表：DROP 旧 FK 约束（tasks/project_kr_links/project_repos）+ okr_projects 补充 sequence_order/current_phase/time_budget_days',
  now()
)
ON CONFLICT (version) DO NOTHING;
