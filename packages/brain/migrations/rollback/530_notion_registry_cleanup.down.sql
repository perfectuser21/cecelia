-- 530 回滚：按备份还原被删的 4 行旧库登记，旧树 Feature 镜像恢复为 active push
BEGIN;

INSERT INTO notion_projection_map
SELECT (jsonb_populate_record(NULL::notion_projection_map, b.row_data)).*
  FROM migration_530_notion_map_backup b
 WHERE b.action = 'deleted'
   AND NOT EXISTS (SELECT 1 FROM notion_projection_map k
                    WHERE k.notion_db_id = b.row_data->>'notion_db_id' AND k.brain_table IS NOT DISTINCT FROM b.row_data->>'brain_table');

UPDATE notion_projection_map m
   SET status = 'active', direction = 'push',
       vessel = b.row_data->>'vessel', notes = b.row_data->>'notes', updated_at = NOW()
  FROM migration_530_notion_map_backup b
 WHERE b.action = 'archived' AND m.brain_table = 'journey_features' AND m.notion_db_id = b.row_data->>'notion_db_id';

DROP TABLE IF EXISTS migration_530_notion_map_backup;
DELETE FROM schema_version WHERE version = '530';

COMMIT;
