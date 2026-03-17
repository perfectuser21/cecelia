-- Migration 112: 修复 notion_id UNIQUE 约束 — 支持 ON CONFLICT (notion_id)
-- migration 111 只创建了普通 INDEX，ON CONFLICT 需要 UNIQUE 约束

-- goals.notion_id: 删除旧普通索引，添加 UNIQUE 约束
DROP INDEX IF EXISTS idx_goals_notion_id;
ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_notion_id_unique;
ALTER TABLE goals ADD CONSTRAINT goals_notion_id_unique UNIQUE (notion_id);

-- projects.notion_id: 删除旧普通索引，添加 UNIQUE 约束
DROP INDEX IF EXISTS idx_projects_notion_id;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_notion_id_unique;
ALTER TABLE projects ADD CONSTRAINT projects_notion_id_unique UNIQUE (notion_id);

-- tasks.notion_id: 删除旧普通索引，添加 UNIQUE 约束
DROP INDEX IF EXISTS idx_tasks_notion_id;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_notion_id_unique;
ALTER TABLE tasks ADD CONSTRAINT tasks_notion_id_unique UNIQUE (notion_id);
