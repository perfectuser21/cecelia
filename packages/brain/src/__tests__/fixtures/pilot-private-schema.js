import {minimumMapSchema} from './minimum-map-schema.js';
import {migrationSql,migrationTable,migrationSlice} from './minimum-definition-schema.js';
export async function preparePilotSchema(db,graphOnly=false){
 if(graphOnly){
  for(const table of ['api_registry','db_schema_registry','test_registry'])await db.query(migrationTable('282_dev_management_tables.sql',table));
  for(const file of ['351_graph_edges.sql','400_fact_snapshot_metadata.sql','410_versioned_graph_snapshots.sql'])await db.query(migrationSql(file));
  return;
 }
 await minimumMapSchema(db);
 await db.query(migrationTable('000_base_schema.sql','pending_actions'));
 await db.query(migrationTable('334_golden_paths.sql','golden_paths'));
 await db.query(migrationSlice('372_golden_path_contract_versions.sql','CREATE TABLE IF NOT EXISTS golden_path_contract_versions','INSERT INTO schema_version'));
 await db.query(migrationSlice('374_gp_assertion_receipts.sql','CREATE TABLE IF NOT EXISTS journey_assertion_receipts','INSERT INTO schema_version'));
}
