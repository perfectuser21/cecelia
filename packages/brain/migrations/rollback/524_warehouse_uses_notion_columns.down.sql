-- Rollback 524：去掉两表的 Notion 记账列与触发器；旧名视图先删再建（视图不能删列）
BEGIN;

DELETE FROM notion_projection_map WHERE notion_db_id IN ('unmapped:enablers', 'unmapped:warehouse_items', 'unmapped:activity_uses');

DROP VIEW IF EXISTS enablers;

DROP TRIGGER IF EXISTS trg_touch_warehouse_items_updated_at ON warehouse_items;
DROP TRIGGER IF EXISTS trg_touch_activity_uses_updated_at ON activity_uses;
DROP FUNCTION IF EXISTS touch_updated_at_ignoring_notion();

ALTER TABLE warehouse_items DROP COLUMN IF EXISTS notion_id, DROP COLUMN IF EXISTS notion_synced_at, DROP COLUMN IF EXISTS notion_digest;
ALTER TABLE activity_uses DROP COLUMN IF EXISTS notion_id, DROP COLUMN IF EXISTS notion_synced_at, DROP COLUMN IF EXISTS notion_digest, DROP COLUMN IF EXISTS updated_at;

CREATE VIEW enablers AS SELECT * FROM warehouse_items;

DELETE FROM schema_version WHERE version = '524';

COMMIT;
