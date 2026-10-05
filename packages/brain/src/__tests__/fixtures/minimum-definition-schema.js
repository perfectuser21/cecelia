import {readFileSync} from 'node:fs';
export function migrationSql(file){return readFileSync(new URL(`../../../migrations/${file}`,import.meta.url),'utf8');}
export function migrationSlice(file,start,end){
 const sql=migrationSql(file),a=sql.indexOf(start),b=end===null?sql.length:sql.indexOf(end,a+start.length);
 if(a<0||b<0)throw Error(`fixture_source_slice_missing:${file}:${start}`);
 return sql.slice(a,b);
}
export function migrationTable(file,table){
 const sql=migrationSql(file),start=`CREATE TABLE IF NOT EXISTS ${table} (`,a=sql.indexOf(start),b=sql.indexOf('\n);',a);
 if(a<0||b<0)throw Error(`fixture_source_table_missing:${file}:${table}`);
 return sql.slice(a,b+4);
}
export async function minimumDefinitionSchema(db,{runs=true}={}){
 for(const table of (runs?['areas','projects','goals','features','tasks']:['areas']))await db.query(migrationTable('000_base_schema.sql',table));
 await db.query(migrationTable('005_schema_version_and_config.sql','schema_version'));
 for(const table of ['journeys','journey_steps','journey_features'])await db.query(migrationTable('282_dev_management_tables.sql',table));
 await db.query(migrationSql('397_journeys_capability_self_ref.sql'));
 await db.query(migrationSlice('348_promise_map_schema.sql','ALTER TABLE journey_steps','-- 3. journey_features'));
 await db.query(migrationSlice('482_backbone_activity_contracts.sql','ALTER TABLE journey_steps','-- 二、获客'));
 await db.query(migrationSlice('483_backbone_body_digest.sql','ALTER TABLE journey_steps','INSERT INTO schema_version'));
 await db.query(migrationSlice('492_steps_enablers.sql','CREATE TABLE IF NOT EXISTS steps','INSERT INTO enablers'));
 await db.query(migrationTable('436_ops_workflows.sql','ops_workflows'));
 await db.query(migrationSql('494_vs_model_workflows.sql'));
 if(runs){await db.query(migrationSql('059_task_runs.sql'));await db.query(migrationSql('495_vs_model_spans.sql'));}
}
