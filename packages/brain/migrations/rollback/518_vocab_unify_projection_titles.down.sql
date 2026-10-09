-- Rollback 518：标题改回旧名（Notion 侧需同步改回，否则两边不一致）
BEGIN;
UPDATE notion_projection_map SET title = 'AI Journey', updated_at = NOW()
 WHERE notion_db_id = '358c40c2-ba63-8148-bde7-e313d789931a';
UPDATE notion_projection_map SET title = 'Backbone Activities', updated_at = NOW()
 WHERE notion_db_id = 'c213e387-b2ae-45a4-98c0-4a66fe3408be';
UPDATE notion_projection_map SET title = '承诺地图格子', updated_at = NOW()
 WHERE notion_db_id = '3e8c40c2-ba63-8194-a47c-dcf5f4b508bb';
UPDATE notion_projection_map SET title = 'Workflows 总库', updated_at = NOW()
 WHERE notion_db_id = '3d9c40c2-ba63-8145-bfa8-f4c0c006e0af';
UPDATE notion_projection_map SET title = 'AI Feature', updated_at = NOW()
 WHERE notion_db_id = '358c40c2-ba63-81e3-96c5-d762b3d34dff';
DELETE FROM schema_version WHERE version = '518';
COMMIT;
