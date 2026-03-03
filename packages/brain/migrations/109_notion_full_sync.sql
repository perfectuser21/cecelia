-- Migration 109: Notion 四表双向同步字段
-- 为 areas/goals/projects/tasks 四张表添加 notion_id + notion_synced_at
-- areas 已有 notion_id（migration 104），补充 notion_synced_at

-- areas: 补充 notion_synced_at
ALTER TABLE areas ADD COLUMN IF NOT EXISTS notion_synced_at TIMESTAMPTZ;

-- goals: 添加 notion_id + notion_synced_at
ALTER TABLE goals ADD COLUMN IF NOT EXISTS notion_id VARCHAR(255);
ALTER TABLE goals ADD COLUMN IF NOT EXISTS notion_synced_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_goals_notion_id ON goals (notion_id) WHERE notion_id IS NOT NULL;

-- projects: 添加 notion_id + notion_synced_at
ALTER TABLE projects ADD COLUMN IF NOT EXISTS notion_id VARCHAR(255);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS notion_synced_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_projects_notion_id ON projects (notion_id) WHERE notion_id IS NOT NULL;

-- tasks: 添加 notion_id + notion_synced_at
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notion_id VARCHAR(255);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notion_synced_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_tasks_notion_id ON tasks (notion_id) WHERE notion_id IS NOT NULL;
