-- Migration 120: 给 Notion 同步表加 notion_props JSONB 列
-- 用于动态捕获 Notion page.properties 全量属性，避免硬编码字段名

ALTER TABLE areas
  ADD COLUMN IF NOT EXISTS notion_props JSONB;

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS notion_props JSONB;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS notion_props JSONB;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS notion_props JSONB;

-- 索引：支持 JSONB 内容查询
CREATE INDEX IF NOT EXISTS areas_notion_props_idx    ON areas    USING gin(notion_props) WHERE notion_props IS NOT NULL;
CREATE INDEX IF NOT EXISTS goals_notion_props_idx    ON goals    USING gin(notion_props) WHERE notion_props IS NOT NULL;
CREATE INDEX IF NOT EXISTS projects_notion_props_idx ON projects USING gin(notion_props) WHERE notion_props IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_notion_props_idx    ON tasks    USING gin(notion_props) WHERE notion_props IS NOT NULL;
