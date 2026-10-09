-- Rollback 525：旧名视图重建，底座引用格子从备份还原，注册表占位补回
-- （迁移里按特性补建的仓库物件 legacy_<id前8位> 与并入的用料不删：它们是有效数据，删了反而丢链接）
BEGIN;

CREATE VIEW journey_steps AS SELECT * FROM activities;
CREATE VIEW journey_step_links AS SELECT * FROM activity_cells;
CREATE VIEW enablers AS SELECT * FROM warehouse_items;

INSERT INTO activity_cells (id, journey_id, step_id, step_order, status, created_at, feature_id, cell_kind, cell_status, assertion_ref, na_reason,
                            cell_key, assertion_revision, updated_at, cell_level, step_id_ref, enabler_id, parent_cell_key)
SELECT b.id, b.journey_id, b.step_id, b.step_order, b.status, b.created_at, b.feature_id, b.cell_kind, b.cell_status, b.assertion_ref, b.na_reason,
       b.cell_key, b.assertion_revision, b.updated_at, b.cell_level, b.step_id_ref, b.enabler_id, b.parent_cell_key
  FROM migration_525_base_ref_cells_backup b
 WHERE NOT EXISTS (SELECT 1 FROM activity_cells c WHERE c.id = b.id);

DROP TABLE IF EXISTS migration_525_base_ref_cells_backup;

INSERT INTO notion_projection_map (notion_db_id, title, face, brain_table, direction, vessel, status, space, reconcile, notes)
SELECT v.db, '（旧名兼容视图）' || v.tbl, 'mirror', v.tbl, 'none', '(旧名兼容视图，无独立血管)', 'archived', 'system', '{"count": true}'::jsonb, '迁移 525 回滚补回'
  FROM (VALUES ('unmapped:journey_steps', 'journey_steps'), ('unmapped:journey_step_links', 'journey_step_links'), ('unmapped:enablers', 'enablers')) AS v(db, tbl)
 WHERE NOT EXISTS (SELECT 1 FROM notion_projection_map WHERE notion_db_id = v.db AND brain_table = v.tbl);

DELETE FROM schema_version WHERE version = '525';

COMMIT;
