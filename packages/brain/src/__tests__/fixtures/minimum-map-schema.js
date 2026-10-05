import {migrationSql,migrationSlice,migrationTable,withLegacyNames} from './minimum-definition-schema.js';
export async function minimumMapSchema(db){
 await withLegacyNames(db,async()=>{
 await db.query(migrationTable('009_fix_decisions_schema.sql','decisions'));
 for(const table of ['api_registry','db_schema_registry','test_registry'])await db.query(migrationTable('282_dev_management_tables.sql',table));
 await db.query(migrationSql('351_graph_edges.sql'));
 await db.query(migrationSql('400_fact_snapshot_metadata.sql'));
 for(const file of ['402_map_manifest_versions.sql','405_map_projection_core.sql','407_map_scope_repositories.sql','410_versioned_graph_snapshots.sql'])await db.query(migrationSql(file));
 await db.query(migrationSlice('283_skill_registry_and_journey_step_links.sql','CREATE TABLE IF NOT EXISTS journey_step_links','-- Note:'));
 await db.query(migrationSlice('348_promise_map_schema.sql','ALTER TABLE journey_step_links','COMMENT ON COLUMN journeys.home'));
 await db.query(migrationSlice('349_promise_map_reconcile.sql','ALTER TABLE journey_step_links',null));
 await db.query(migrationSlice('374_gp_assertion_receipts.sql','ALTER TABLE journey_step_links','CREATE TABLE IF NOT EXISTS journey_assertion_receipts'));
 await db.query(migrationSlice('496_probe_targets_cells_levels.sql','ALTER TABLE journey_step_links','-- step 级格子'));
 });
}
