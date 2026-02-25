-- Migration 074: 实体状态管理约束
-- 添加部分唯一约束，防止重复的已取消实体

-- 为 tasks 表添加部分唯一约束：相同标题和已取消状态不能重复
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_title_cancelled_unique
ON tasks (title)
WHERE status IN ('cancelled', 'canceled');

-- 为 projects 表添加部分唯一约束：相同名称和已取消状态不能重复
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name_cancelled_unique
ON projects (name)
WHERE status IN ('cancelled', 'canceled');

-- 为 goals 表添加部分唯一约束：相同标题和已取消状态不能重复
CREATE UNIQUE INDEX IF NOT EXISTS idx_goals_title_cancelled_unique
ON goals (title)
WHERE status IN ('cancelled', 'canceled');

-- 添加注释说明约束的目的
COMMENT ON INDEX idx_tasks_title_cancelled_unique IS '防止创建相同标题的多个已取消任务';
COMMENT ON INDEX idx_projects_name_cancelled_unique IS '防止创建相同名称的多个已取消项目';
COMMENT ON INDEX idx_goals_title_cancelled_unique IS '防止创建相同标题的多个已取消目标';

INSERT INTO schema_version (version) VALUES ('074');