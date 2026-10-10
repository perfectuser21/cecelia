-- 543 回滚：撤下技能工厂看板的注册表登记与页链接（Notion 库本身不删）
BEGIN;
DELETE FROM notion_projection_map
 WHERE brain_table IS NULL
   AND notion_db_id = '3f5c40c2-ba63-818e-9813-dedb2576f8e5';
DELETE FROM projection_links WHERE target = 'notion-skill-factory';
DELETE FROM schema_version WHERE version = '543';
COMMIT;
