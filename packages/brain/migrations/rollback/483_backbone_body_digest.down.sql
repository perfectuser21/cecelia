-- 回滚 483：删正文指纹列（Notion 页面正文保持现状，不再更新）。
BEGIN;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS notion_body_digest;
DELETE FROM schema_version WHERE version = '483';
COMMIT;
