import {createHash} from 'node:crypto';
import {runtimeIdentitiesSql} from '../../scripts/schema/runtime-identities.mjs';
import {runtimeVersionGraphSql} from '../../scripts/schema/runtime-version-graph.mjs';
const quoted=value=>{if(typeof value!=='string'||!/^[a-z][a-z0-9_]{0,62}$/.test(value))throw Error('非法schema');return `"${value}"`;};
const digest=value=>createHash('sha256').update(value).digest('hex');
const TABLES=['agent_configuration_versions','implementation_components','implementation_versions','version_refs','version_edges','version_seals','execution_compositions','catalog_structure_seals'];
const FUNCTIONS=['reject_history_change','lock_version_graph','guard_version_edge','seal_version','freeze_composition','validate_frozen_slots','validate_git_location'];
async function structureFingerprint(db,schema) {
 const queries={
  columns:`SELECT c.relname,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) default_value
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname=$1 AND c.relname=ANY($2) ORDER BY c.relname,a.attnum`,
  constraints:`SELECT c.relname,k.conname,k.convalidated,pg_get_constraintdef(k.oid,true) definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=ANY($2) ORDER BY c.relname,k.conname`,
  triggers:`SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=ANY($2) AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
  indexes:`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename=ANY($2) ORDER BY tablename,indexname`,
  functions:`SELECT p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=$1 AND p.proname=ANY($2) ORDER BY p.proname,arguments`
 };
 const snapshot={};for(const [kind,sql]of Object.entries(queries))snapshot[kind]=(await db.query(sql,[schema,kind==='functions'?FUNCTIONS:TABLES])).rows;
 return digest(JSON.stringify(snapshot));
}
export async function installScratchVersionGraph(db,{schema='runtime',sourceSchema='public'}={}) {
 if((await db.query('SELECT current_database() name')).rows[0].name!=='cecelia_scratch')throw Object.assign(Error('只允许cecelia_scratch'),{code:'SCRATCH_REQUIRED'});
 if(typeof db.release!=='function')throw Object.assign(Error('需要签出的Client'),{code:'CLIENT_REQUIRED'});
 if(schema===sourceSchema)throw Error('治理schema须与原件分开');
 const catalog=quoted(schema),source=quoted(sourceSchema);
 const render=sql=>sql.replaceAll('__catalog__',catalog).replaceAll('__source__',source).replaceAll('__CATALOG_NAME__',schema);
 const sql=render(runtimeVersionGraphSql),hash=digest(sql),identityHash=digest(render(runtimeIdentitiesSql));
 await db.query('BEGIN');
 try {
  await db.query("SET LOCAL lock_timeout='2500ms';SET LOCAL statement_timeout='30000ms'");
  await db.query('SET LOCAL search_path TO pg_catalog');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,621))',[`runtime-identities:${schema}`]);
  const base=(await db.query(`SELECT digest FROM ${catalog}.catalog_versions WHERE module='identity-v1'`)).rows[0];
  if(base?.digest!==identityHash)throw Object.assign(Error('身份层原件与来源不匹配'),{code:'IDENTITY_BASE_MISMATCH'});
  const existing=(await db.query(`SELECT digest FROM ${catalog}.catalog_versions WHERE module='version-graph-v1'`)).rows[0];
  if(existing) {
   if(existing.digest!==hash)throw Object.assign(Error('版本图安装包漂移'),{code:'CATALOG_VERSION_CONFLICT'});
   for(const table of TABLES)if(!(await db.query('SELECT to_regclass($1) name',[`${schema}.${table}`])).rows[0].name)throw Object.assign(Error('版本图结构缺失'),{code:'CATALOG_SCHEMA_DRIFT'});
   const seal=(await db.query(`SELECT fingerprint FROM ${catalog}.catalog_structure_seals WHERE module='version-graph-v1'`)).rows[0];
   if(!seal||seal.fingerprint!==await structureFingerprint(db,schema))throw Object.assign(Error('版本图约束、触发器或函数漂移'),{code:'CATALOG_SCHEMA_DRIFT'});
  }else {
   await db.query(sql);await db.query(`INSERT INTO ${catalog}.catalog_versions(module,digest) VALUES('version-graph-v1',$1)`,[hash]);
   await db.query(`INSERT INTO ${catalog}.catalog_structure_seals(module,fingerprint) VALUES('version-graph-v1',$1)`,[await structureFingerprint(db,schema)]);
  }
  await db.query('COMMIT');return {schema,source_schema:sourceSchema,digest:hash,created:!existing,production_migration_applied:false};
 }catch(error){await db.query('ROLLBACK');throw error;}
}

// 只列历史依赖影响，不修改消费者、业务定义或当前版本指针。
export async function readVersionImpact(db,{schema='runtime',versionId}) {
 const catalog=quoted(schema);
 const result=await db.query(`WITH RECURSIVE impacted(id) AS(SELECT id FROM ${catalog}.version_refs WHERE id=$1
   UNION SELECT e.consumer_id FROM ${catalog}.version_edges e JOIN impacted i ON e.dependency_id=i.id)
  SELECT v.id,v.kind,v.object_id,v.source_version_id,(s.version_id IS NOT NULL) sealed
   FROM impacted i JOIN ${catalog}.version_refs v ON v.id=i.id LEFT JOIN ${catalog}.version_seals s ON s.version_id=v.id ORDER BY v.kind,v.id`,[versionId]);
 const compositions=await db.query(`SELECT id,workflow_id,composition_sha256 FROM ${catalog}.execution_compositions WHERE member_refs && $1::uuid[] ORDER BY id`,[result.rows.map(v=>v.id)]);
 return {versions:result.rows,compositions:compositions.rows,current_pointers_changed:false};
}
