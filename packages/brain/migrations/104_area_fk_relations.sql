-- Migration 104: Area 完整双向关联
-- 给 goals/projects/tasks 三张表建立与 areas 表的外键约束
-- goals 表新增 area_id 字段
-- projects/tasks 表已有 area_id 字段，补加 FK 约束

-- ============================================================
-- 1. goals 表新增 area_id
-- ============================================================
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES areas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_goals_area_id ON goals (area_id) WHERE area_id IS NOT NULL;

-- ============================================================
-- 2. projects.area_id 补加 FK 约束
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'projects'::regclass
      AND conname = 'projects_area_id_fkey'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_area_id_fkey
      FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE SET NULL;
  END IF;
END$$;

-- ============================================================
-- 3. tasks.area_id 补加 FK 约束
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tasks'::regclass
      AND conname = 'tasks_area_id_fkey'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_area_id_fkey
      FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE SET NULL;
  END IF;
END$$;
