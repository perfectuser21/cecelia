-- Rollback 525：旧名视图重建，底座引用格子从备份还原，注册表占位补回
BEGIN;

CREATE VIEW journey_steps AS SELECT * FROM activities;
CREATE VIEW journey_step_links AS SELECT * FROM activity_cells;
CREATE VIEW enablers AS SELECT * FROM warehouse_items;

INSERT INTO activity_cells
SELECT b.* FROM migration_525_base_ref_cells_backup b
 WHERE NOT EXISTS (SELECT 1 FROM activity_cells c WHERE c.id = b.id);

DROP TABLE IF EXISTS migration_525_base_ref_cells_backup;

INSERT INTO notion_projection_map (notion_db_id, title, face, brain_table, direction, vessel, status, space, reconcile, notes)
SELECT v.db, '（旧名兼容视图）' || v.tbl, 'mirror', v.tbl, 'none', '(旧名兼容视图，无独立血管)', 'archived', 'system', '{"count": true}'::jsonb, '迁移 525 回滚补回'
  FROM (VALUES ('unmapped:journey_steps', 'journey_steps'), ('unmapped:journey_step_links', 'journey_step_links'), ('unmapped:enablers', 'enablers')) AS v(db, tbl)
 WHERE NOT EXISTS (SELECT 1 FROM notion_projection_map WHERE notion_db_id = v.db AND brain_table = v.tbl);

DELETE FROM schema_version WHERE version = '525';

COMMIT;
