-- Rollback 523：注册表键改回旧名，旧混合库恢复推送，登记名改回 Ops 运行图谱
BEGIN;

UPDATE notion_projection_map SET brain_table = 'journey_steps', updated_at = NOW() WHERE brain_table = 'activities';
UPDATE notion_projection_map SET brain_table = 'journey_step_links', updated_at = NOW() WHERE brain_table = 'activity_cells';

UPDATE projection_links SET entity_type = 'journey_steps', updated_at = NOW() WHERE entity_type = 'activities';

UPDATE notion_projection_map
   SET status = 'active', direction = 'push', title = '价值流与能力（journeys）', updated_at = NOW()
 WHERE brain_table = 'journeys' AND notion_db_id = '358c40c2-ba63-8148-bde7-e313d789931a';

UPDATE notion_projection_map
   SET title = 'Ops 运行图谱', updated_at = NOW()
 WHERE notion_db_id = '3d3c40c2-ba63-815e-be8a-f5048c070d80' AND title = '闹钟总账';

DELETE FROM schema_version WHERE version = '523';

COMMIT;
