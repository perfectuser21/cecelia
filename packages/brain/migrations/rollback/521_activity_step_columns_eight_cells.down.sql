-- Rollback 521：删补的灰格、还原格子名、删补的关系行、去新列、activity_uses 改回 activity_items、视图恢复旧列集
BEGIN;

-- 视图依赖新列，先删视图，列去完再按旧列集重建
DROP VIEW IF EXISTS activities;
DROP VIEW IF EXISTS activity_cells;

DELETE FROM journey_step_links WHERE id IN (SELECT row_id::uuid FROM migration_521_backup WHERE table_name = 'journey_step_links.inserted');
UPDATE journey_step_links l SET cell_key = b.payload->>'cell_key', updated_at = NOW()
  FROM migration_521_backup b
 WHERE b.table_name = 'journey_step_links.renamed' AND l.id = b.row_id::uuid;
ALTER TABLE journey_step_links DROP COLUMN IF EXISTS parent_cell_key;

DELETE FROM workflow_activity_refs WHERE source_ref = 'migration:521';

ALTER TABLE activity_uses RENAME TO activity_items;
ALTER INDEX IF EXISTS idx_activity_uses_item RENAME TO idx_activity_items_item;

ALTER TABLE steps DROP COLUMN IF EXISTS name;
ALTER TABLE steps DROP COLUMN IF EXISTS action;
ALTER TABLE steps DROP COLUMN IF EXISTS inputs;
ALTER TABLE steps DROP COLUMN IF EXISTS outputs;
ALTER TABLE steps DROP COLUMN IF EXISTS on_fail;

ALTER TABLE journey_steps DROP COLUMN IF EXISTS inputs;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS outputs;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS preconditions;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS invariants;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS nfr;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS failure;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS readback;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS judgment;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS adversarial;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS shelf_life_days;
CREATE VIEW activities AS SELECT * FROM journey_steps;
CREATE VIEW activity_cells AS SELECT * FROM journey_step_links;

DROP TABLE IF EXISTS migration_521_backup;
DELETE FROM schema_version WHERE version = '521';

COMMIT;
