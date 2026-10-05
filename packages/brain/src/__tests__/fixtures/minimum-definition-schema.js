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
 // 迁移 527：Activity 的位置由流程引用推出，journey_id / step_number 不再必填也不再按它们唯一，身份按 (capability_key, activity_key) 唯一
 await db.query(`ALTER TABLE journey_steps ALTER COLUMN journey_id DROP NOT NULL,ALTER COLUMN step_number DROP NOT NULL;
ALTER TABLE journey_steps DROP CONSTRAINT IF EXISTS journey_steps_journey_id_step_number_key;`);
 await db.query(migrationSlice('348_promise_map_schema.sql','ALTER TABLE journey_steps','-- 3. journey_features'));
 await db.query(migrationSlice('482_backbone_activity_contracts.sql','ALTER TABLE journey_steps','-- 二、获客'));
 await db.query('DROP INDEX IF EXISTS uq_journey_steps_activity;CREATE UNIQUE INDEX IF NOT EXISTS uq_activities_capability_activity ON journey_steps(capability_key,activity_key) WHERE activity_key IS NOT NULL;');
 await db.query(migrationSlice('483_backbone_body_digest.sql','ALTER TABLE journey_steps','INSERT INTO schema_version'));
 await db.query(migrationSlice('492_steps_enablers.sql','CREATE TABLE IF NOT EXISTS steps','INSERT INTO enablers'));
 await db.query(migrationTable('436_ops_workflows.sql','ops_workflows'));
 await db.query(migrationSql('494_vs_model_workflows.sql'));
 if(runs){await db.query(migrationSql('059_task_runs.sql'));await db.query(migrationSql('495_vs_model_spans.sql'));}
 await useStandardNames(db);
}

// 迁移 522 起生产库里 activities / activity_cells / warehouse_items 是真表，旧名 journey_steps / journey_step_links / enablers 是视图。
// 夹具镜像这一形状：旧迁移（282/348/482/492/494/…）按旧名建表与加列，所以重放期间要把真表临时叫回旧名（withLegacyNames），
// 重放完再改回标准名并重建旧名视图（useStandardNames）；被测代码按标准名查，测试里的裸 SQL 仍可按旧名写。
const LEGACY_PAIRS=[['journey_steps','activities'],['journey_step_links','activity_cells'],['enablers','warehouse_items']];
const LIKE_SOURCE=Object.freeze(Object.fromEntries(LEGACY_PAIRS));
export const likeSource=(table)=>LIKE_SOURCE[table]??table;
async function relkind(db,name){return (await db.query("SELECT c.relkind FROM pg_class c WHERE c.relname=$1 AND c.relnamespace=current_schema()::regnamespace",[name])).rows[0]?.relkind;}
export async function useStandardNames(db){
 for(const [oldName,newName] of LEGACY_PAIRS){
  if(await relkind(db,oldName)==='v')await db.query(`DROP VIEW ${oldName}`);
  if(await relkind(db,oldName)==='r'&&!(await relkind(db,newName)))await db.query(`ALTER TABLE ${oldName} RENAME TO ${newName}`);
  if(await relkind(db,newName)==='r'&&!(await relkind(db,oldName)))await db.query(`CREATE VIEW ${oldName} AS SELECT * FROM ${newName}`);
 }
}
export async function withLegacyNames(db,fn){
 for(const [oldName,newName] of LEGACY_PAIRS){
  if(await relkind(db,oldName)==='v')await db.query(`DROP VIEW ${oldName}`);
  if(await relkind(db,newName)==='r'&&!(await relkind(db,oldName)))await db.query(`ALTER TABLE ${newName} RENAME TO ${oldName}`);
 }
 try{return await fn();}finally{await useStandardNames(db);}
}
