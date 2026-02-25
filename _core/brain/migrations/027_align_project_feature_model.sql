-- Migration 027: Align Project/Feature/Initiative Model
--
-- 实现 "Project = Initiative = Feature" 统一模型
--
-- 当前问题：
--   - features 表多余（空表，0 条数据）
--   - pr_plans.initiative_id 冗余（指向已删除的 features 表）
--   - tasks.feature_id 冗余（指向已删除的 features 表）
--
-- 目标模型：
--   OKR → KR → Project → PR Plan → Task
--   Project 用 parent_id 支持 Sub-Project（可选）

-- ============================================================
-- 1. 删除 features 表（空表，直接删）
-- ============================================================
DROP TABLE IF EXISTS features CASCADE;

-- ============================================================
-- 2. 清理 pr_plans 的冗余外键
-- ============================================================
-- 删除 initiative_id（指向已删除的 features 表）
ALTER TABLE pr_plans DROP COLUMN IF EXISTS initiative_id;

-- 只保留 project_id（指向 projects 表）
-- pr_plans.project_id → projects.id

-- ============================================================
-- 3. 清理 tasks 的冗余外键
-- ============================================================
-- 删除 feature_id（指向已删除的 features 表）
ALTER TABLE tasks DROP COLUMN IF EXISTS feature_id;

-- 保留的外键：
-- tasks.project_id → projects.id (执行入口)
-- tasks.goal_id    → goals.id    (挂 KR)
-- tasks.pr_plan_id → pr_plans.id (PR 边界分组)

-- ============================================================
-- 4. 确认 projects 表结构正确
-- ============================================================
-- projects 表应该有：
--   id: 主键
--   parent_id: 支持 Sub-Project（可选，repo_path=NULL 表示子项）
--   kr_id: 外键指向 goals (KR)
--   repo_path: 仓库路径（顶层 Project 有值，Sub-Project 为 NULL）

-- 检查 kr_id 外键是否存在
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'projects_kr_id_fkey'
  ) THEN
    ALTER TABLE projects
    ADD CONSTRAINT projects_kr_id_fkey
    FOREIGN KEY (kr_id) REFERENCES goals(id);
  END IF;
END $$;

-- ============================================================
-- 5. Update schema_version
-- ============================================================

INSERT INTO schema_version (version, description)
VALUES ('027', 'Align Project/Feature/Initiative Model - Delete features table, clean foreign keys')
ON CONFLICT (version) DO NOTHING;
