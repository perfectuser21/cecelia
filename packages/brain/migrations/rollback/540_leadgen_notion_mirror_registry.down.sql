-- 540 回滚：撤下获客三张 Notion 镜子库的注册表登记（Notion 库本身不删）
BEGIN;
DELETE FROM notion_projection_map
 WHERE brain_table IS NULL
   AND notion_db_id IN ('3f5c40c2-ba63-814c-ac06-e557331075f6', '3f5c40c2-ba63-8187-a9e8-d3a4376ce622', '3f5c40c2-ba63-81bc-9613-cd71f15fdec5');
DELETE FROM schema_version WHERE version = '540';
COMMIT;
