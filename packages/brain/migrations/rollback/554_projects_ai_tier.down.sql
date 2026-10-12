-- 回滚将移除 ai_tier 列（丢失档位设置）；项目与 Notion 关联数据保留。
BEGIN;
DROP INDEX IF EXISTS idx_projects_notion_id_unique;
ALTER TABLE projects DROP COLUMN IF EXISTS ai_tier;
DELETE FROM schema_version WHERE version = '554';
COMMIT;
