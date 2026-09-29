-- Rollback 487: 撤销价值流镜子接线
DELETE FROM notion_projection_map
 WHERE (notion_db_id = '3eac40c2-ba63-817f-a964-f071c78cb711' AND brain_table = 'map_projection_nodes')
    OR (notion_db_id = '902b85550fb54ae0bdf89b0d7a23a3f2' AND brain_table IS NULL);

UPDATE notion_projection_map
   SET status = 'pending_vessel',
       notes = regexp_replace(COALESCE(notes, ''), '；迁移 487 归档：.*$', ''),
       updated_at = NOW()
 WHERE notion_db_id = 'unmapped:value_streams' AND brain_table = 'value_streams';

DROP TABLE IF EXISTS notion_map_node_pages;

DELETE FROM schema_version WHERE version = '487';
