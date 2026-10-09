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
 await splitJourneys(db);
 // 迁移 520/521：Activity 用仓库哪几件（workflow-read-service 的共享组件读它）
 await db.query(`CREATE TABLE IF NOT EXISTS activity_uses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),activity_id uuid NOT NULL REFERENCES journey_steps(id) ON DELETE CASCADE,item_id uuid NOT NULL REFERENCES enablers(id) ON DELETE CASCADE,role text NOT NULL DEFAULT 'uses',assertion_ref text,cell_status text,legacy_cell_id uuid,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(activity_id,item_id))`);
 await useStandardNames(db);
}

// 树+仓库 v3.0 第 6 刀的形状：价值流 / 能力是两张真表，journeys 只剩一个只读 UNION 视图（兼容外部消费者）。
// 旧迁移（282/397/494/…）按单表 journeys 建表和外键，所以重放完才拆：旧表的行按角色分进两张新表，
// 指向旧表的外键随 DROP … CASCADE 一起掉（生产里它们靠守卫触发器），工作流外键改指能力。
async function splitJourneys(db){
 if(await relkind(db,'journeys')!=='r')return;
 await db.query(`CREATE TABLE value_streams (LIKE journeys INCLUDING ALL);
CREATE TABLE capabilities (LIKE journeys INCLUDING ALL);
INSERT INTO value_streams SELECT * FROM journeys WHERE parent_journey_id IS NULL;
INSERT INTO capabilities SELECT * FROM journeys WHERE parent_journey_id IS NOT NULL;`);
 await replaceJourneysTableWithView(db);
 if(await relkind(db,'workflows'))await db.query('ALTER TABLE workflows DROP CONSTRAINT IF EXISTS workflows_capability_id_fkey;ALTER TABLE workflows ADD CONSTRAINT workflows_capability_id_fkey FOREIGN KEY (capability_id) REFERENCES capabilities(id)');
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
// 旧迁移重放期间 journeys 要是真表（外键、旧形状读写都按它），重放完再拆回两张真表 + 只读视图。
async function restoreJourneysTable(db){
 if(await relkind(db,'journeys')!=='v')return false;
 const views=await journeyDependentViews(db);
 await db.query('DROP VIEW journeys CASCADE;CREATE TABLE journeys (LIKE value_streams INCLUDING ALL);ALTER TABLE journeys DROP CONSTRAINT IF EXISTS value_streams_is_root');
 // 生产形状的子表里 kind 是生成列，复制行时要跳过
 const cols=(await db.query("SELECT string_agg(quote_ident(column_name),',' ORDER BY ordinal_position) AS c FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='journeys' AND is_generated='NEVER'")).rows[0].c;
 await db.query(`INSERT INTO journeys(${cols}) SELECT ${cols} FROM value_streams UNION ALL SELECT ${cols} FROM capabilities`);
 await recreateViews(db,views);
 return true;
}
// 删 journeys 表会连带删依赖它的视图（如 activity_flow_metrics）：先记下定义，换成只读视图后按原样重建。
async function journeyDependentViews(db){
 return (await db.query("SELECT DISTINCT c.relname, pg_get_viewdef(c.oid,true) AS def FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid JOIN pg_class c ON c.oid=r.ev_class WHERE d.refobjid='journeys'::regclass AND c.relkind='v' AND c.relnamespace=current_schema()::regnamespace AND c.relname<>'journeys'")).rows;
}
const recreateViews=async(db,views)=>{for(const v of views)await db.query(`CREATE OR REPLACE VIEW ${v.relname} AS ${v.def.replace(/;\s*$/,'')}`);};
async function replaceJourneysTableWithView(db){
 const views=await journeyDependentViews(db);
 await db.query('DROP TABLE journeys CASCADE;CREATE VIEW journeys AS SELECT * FROM value_streams UNION ALL SELECT * FROM capabilities');
 await recreateViews(db,views);
}
const resplitJourneys=replaceJourneysTableWithView;
export async function withLegacyNames(db,fn){
 for(const [oldName,newName] of LEGACY_PAIRS){
  if(await relkind(db,oldName)==='v')await db.query(`DROP VIEW ${oldName}`);
  if(await relkind(db,newName)==='r'&&!(await relkind(db,oldName)))await db.query(`ALTER TABLE ${newName} RENAME TO ${oldName}`);
 }
 const restored=await restoreJourneysTable(db);
 let failed=false;
 try{return await fn();}catch(error){failed=true;throw error;}
 // fn 抛错时事务可能已中止，清理会再抛一个无关的 25P02 把真正的错误盖住：此时只保原错误
 finally{try{if(restored)await resplitJourneys(db);await useStandardNames(db);}catch(error){if(!failed)throw error;}}
}
