-- Rollback 534: 按 migration_534_backup 把回归格的 journey_id 还原成迁移前的值。

BEGIN;

UPDATE activity_cells c
   SET journey_id = b.journey_id, notion_synced_at = NULL
  FROM migration_534_backup b
 WHERE c.id::text = b.row_id;

DELETE FROM schema_version WHERE version = '534';

COMMIT;
