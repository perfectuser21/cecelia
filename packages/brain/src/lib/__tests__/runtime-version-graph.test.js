import {afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';import pg from 'pg';
import {scratchOnlyConnection} from '../../__tests__/fixtures/scratch-only-db.js';
import {installScratchIdentities} from '../runtime-identities.js';
import {installScratchVersionGraph,readVersionImpact} from '../runtime-version-graph.js';
let db,pool,source,schema,connection,ids,refs;
const uid=()=>randomUUID();
beforeAll(async()=>{connection=await scratchOnlyConnection();});
const ref=async(kind,object,version)=>{
 const column={workflow_definition:'workflow_definition_id',activity_contract:'activity_contract_id',activity_build:'activity_build_id',skill_source:'skill_source_id',agent_configuration:'agent_configuration_id',implementation:'implementation_id'}[kind];
 return(await db.query(`INSERT INTO ${schema}.version_refs(kind,object_id,source_version_id,${column}) VALUES($1,$2,$3,$3) RETURNING id`,[kind,object,version])).rows[0].id;
};
const edge=(consumer,dependency,relation)=>db.query(`INSERT INTO ${schema}.version_edges(consumer_id,dependency_id,relation,actor) VALUES($1,$2,$3,'fixture')`,[consumer,dependency,relation]);
const seal=id=>db.query(`INSERT INTO ${schema}.version_seals(version_id,actor) VALUES($1,'fixture')`,[id]);
const compose=async(bindings=[{slot_key:'slot-a',build_ref:refs.build},{slot_key:'slot-b',build_ref:refs.build}])=>db.query(`INSERT INTO ${schema}.execution_compositions
 (workflow_id,workflow_definition_id,recipe_id,agent_id,agent_configuration_id,implementation_component_id,implementation_version_id,build_bindings,actor)
 VALUES($1,$2,1,$3,$4,$5,$6,$7,'fixture') ON CONFLICT DO NOTHING RETURNING *`,[ids.wf,ids.wv,ids.agent,ids.cfg,ids.component,ids.impl,JSON.stringify(bindings)]);
beforeEach(async()=>{
 pool=new pg.Pool(connection);db=await pool.connect();source='graph_source_'+uid().replaceAll('-','');schema='graph_catalog_'+uid().replaceAll('-','');
 ids=Object.fromEntries(['wf','wv','activity','av','build','skill','agent','cfg','component','impl'].map(k=>[k,uid()]));refs={};
 if((await db.query('SELECT current_database() name')).rows[0].name!=='cecelia_scratch')throw Error('scratch required');
 await db.query(`CREATE SCHEMA ${source};
 CREATE TABLE ${source}.ops_agents(id bigint PRIMARY KEY,source text,host_alias text,name text,agent_type text);
 CREATE TABLE ${source}.skill_registry(id uuid PRIMARY KEY,name text);
 CREATE TABLE ${source}.ops_skills(id bigint PRIMARY KEY,name text);
 CREATE TABLE ${source}.workflow_definition_versions(id uuid PRIMARY KEY,workflow_id uuid NOT NULL,payload jsonb NOT NULL,UNIQUE(workflow_id,id));
 CREATE TABLE ${source}.activity_versions(id uuid PRIMARY KEY,activity_id uuid NOT NULL,UNIQUE(activity_id,id));
 CREATE TABLE ${source}.activity_definition_versions(id uuid PRIMARY KEY,activity_id uuid NOT NULL,UNIQUE(activity_id,id));
 CREATE TABLE ${source}.activity_version_builds(build_id uuid PRIMARY KEY,activity_id uuid NOT NULL,activity_version_id uuid NOT NULL);
 CREATE TABLE ${source}.workflow_production_recipes(id bigint PRIMARY KEY,workflow_id uuid NOT NULL,recipe jsonb NOT NULL);`);
 await db.query(`INSERT INTO ${source}.skill_registry VALUES($1,'fixture')`,[ids.skill]);
 const snapshot={activities:['slot-a','slot-b'].map((slot_key,i)=>({slot_key,sequence_no:i+1,activity_id:ids.activity,activity_version_id:ids.build}))};
 await db.query(`INSERT INTO ${source}.workflow_definition_versions VALUES($1,$2,$3)`,[ids.wv,ids.wf,JSON.stringify(snapshot)]);
 await db.query(`INSERT INTO ${source}.activity_versions VALUES($1,$2)`,[ids.av,ids.activity]);
 await db.query(`INSERT INTO ${source}.activity_definition_versions VALUES($1,$2)`,[ids.build,ids.activity]);
 await db.query(`INSERT INTO ${source}.activity_version_builds VALUES($1,$2,$3)`,[ids.build,ids.activity,ids.av]);
 const recipe=['slot-a','slot-b'].map((slot_key,i)=>({slot_key,sequence_no:i+1,activity_id:ids.activity,activity_version_id:ids.av,content_md5:'fixture'}));
 await db.query(`INSERT INTO ${source}.workflow_production_recipes VALUES(1,$1,$2)`,[ids.wf,JSON.stringify(recipe)]);
 await installScratchIdentities(db,{schema,sourceSchema:source});await installScratchVersionGraph(db,{schema,sourceSchema:source});
 await db.query(`INSERT INTO ${schema}.agent_identities(id,display_name) VALUES($1,'fixture')`,[ids.agent]);
 await db.query(`INSERT INTO ${schema}.agent_configuration_versions(id,agent_id,source_repo,source_path,source_commit,manifest_sha256,executor_kind,model_provider,model_name,actor)
 VALUES($1,$2,'owner/repo','agents/fixture.json','${'c'.repeat(40)}','${'a'.repeat(64)}','fixture','fixture','fixture-model','fixture')`,[ids.cfg,ids.agent]);
 await db.query(`INSERT INTO ${schema}.implementation_components(id,component_key) VALUES($1,'fixture:runner')`,[ids.component]);
 await db.query(`INSERT INTO ${schema}.implementation_versions(id,component_id,source_repo,source_path,source_commit,artifact_sha256,actor)
 VALUES($1,$2,'owner/repo','scripts/run.js','${'c'.repeat(40)}','${'d'.repeat(64)}','fixture')`,[ids.impl,ids.component]);
 const skill=(await db.query(`INSERT INTO ${schema}.skill_source_versions(skill_id,source_repo,source_path,source_commit,manifest,actor)
 VALUES($1,'owner/repo','skills/fixture','${'c'.repeat(40)}',$2,'fixture') RETURNING id`,[ids.skill,JSON.stringify([{path:'SKILL.md',sha256:'a'.repeat(64)}])])).rows[0].id;
 for(const [kind,object,version,key]of [['skill_source',ids.skill,skill,'skill'],['activity_contract',ids.activity,ids.av,'contract'],['implementation',ids.component,ids.impl,'impl'],['agent_configuration',ids.agent,ids.cfg,'cfg'],['activity_build',ids.activity,ids.build,'build'],['workflow_definition',ids.wf,ids.wv,'wf']])refs[key]=await ref(kind,object,version);
 await seal(refs.skill);await seal(refs.contract);await seal(refs.impl);
 await edge(refs.cfg,refs.skill,'uses_source');await seal(refs.cfg);
 await edge(refs.build,refs.contract,'implements');await edge(refs.build,refs.skill,'uses_source');await seal(refs.build);
 await edge(refs.wf,refs.contract,'contract');await seal(refs.wf);
});
afterEach(async()=>{try{if(db)await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE;DROP SCHEMA IF EXISTS ${source} CASCADE`);}finally{db?.release();await pool?.end();db=null;}});
it('版本引用以真实复合FK校验对象，类型列不能错配',async()=>{
 const unseen=uid();await db.query(`INSERT INTO ${source}.activity_versions VALUES($1,$2)`,[unseen,ids.activity]);
 await expect(ref('activity_contract',uid(),unseen)).rejects.toMatchObject({code:'23503'});
 await expect(db.query(`INSERT INTO ${schema}.version_refs(kind,object_id,source_version_id,skill_source_id) VALUES('activity_contract',$1,$2,$2)`,[ids.activity,ids.av])).rejects.toMatchObject({code:'23514'});
 await expect(ref('activity_build',ids.activity,uid())).rejects.toMatchObject({code:'23503'});
});
it('完整组合逐slot绑定，共享Activity重复出现仍保留两slot；同内容幂等、不可修改或扩边',async()=>{
 const row=(await compose()).rows[0];expect(row.build_bindings).toHaveLength(2);expect(row.member_refs).toHaveLength(6);expect(row.composition_sha256).toMatch(/^[a-f0-9]{64}$/);
 expect((await compose([{slot_key:'slot-b',build_ref:refs.build},{slot_key:'slot-a',build_ref:refs.build}])).rows).toHaveLength(0);
 await expect(db.query(`UPDATE ${schema}.execution_compositions SET actor='other'`)).rejects.toMatchObject({code:'P0001'});
 await expect(edge(refs.build,refs.impl,'executes_implementation')).rejects.toMatchObject({code:'23514'});
 await expect(db.query(`TRUNCATE ${schema}.version_edges`)).rejects.toMatchObject({code:'P0001'});
});
it('Skill影响指向配置、构建及组合；不自动改业务契约或Workflow',async()=>{
 await compose();const impact=await readVersionImpact(db,{schema,versionId:refs.skill});
 expect(impact.versions.map(v=>v.kind).sort()).toEqual(['activity_build','agent_configuration','skill_source']);expect(impact.compositions).toHaveLength(1);expect(impact.current_pointers_changed).toBe(false);
 expect((await db.query(`SELECT count(*)::int n FROM ${source}.workflow_definition_versions`)).rows[0].n).toBe(1);
 expect((await db.query(`SELECT count(*)::int n FROM ${source}.activity_versions`)).rows[0].n).toBe(1);
});
it('缺slot、重复slot、跨Activity和不实现固定契约的构建不能冻结',async()=>{
 for(const bindings of [[{slot_key:'slot-a',build_ref:refs.build}],[{slot_key:'slot-a',build_ref:refs.build},{slot_key:'slot-a',build_ref:refs.build}],
 [{slot_key:'slot-a',build_ref:refs.impl},{slot_key:'slot-b',build_ref:refs.build}]])await expect(compose(bindings)).rejects.toMatchObject({code:'23514'});
 expect((await db.query(`SELECT count(*)::int n FROM ${schema}.execution_compositions`)).rows[0].n).toBe(0);
});
it('类型错误、未封存、环及旧快照写入拒绝；失败事务不留边',async()=>{
 const a=uid(),b=uid();for(const [id,name]of [[a,'a'],[b,'b']])await db.query(`INSERT INTO ${schema}.implementation_versions(id,component_id,source_repo,source_path,source_commit,artifact_sha256,actor)
 VALUES($1,$2,'owner/repo',$3,'${'e'.repeat(40)}','${'f'.repeat(64)}','fixture')`,[id,ids.component,name+'.js']);
 const va=await ref('implementation',ids.component,a),vb=await ref('implementation',ids.component,b);
 await expect(edge(va,refs.contract,'uses_source')).rejects.toMatchObject({code:'23514'});
 await edge(va,vb,'executes_implementation');await expect(edge(vb,va,'executes_implementation')).rejects.toMatchObject({code:'23514'});
 await expect(seal(va)).rejects.toMatchObject({code:'23514'});await seal(vb);await seal(va);
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await expect(edge(vb,refs.skill,'uses_source')).rejects.toMatchObject({code:'25000'});await db.query('ROLLBACK');
 expect((await db.query(`SELECT count(*)::int n FROM ${schema}.version_edges WHERE consumer_id=$1`,[va])).rows[0].n).toBe(1);
});
it('仅scratch可安装，幂等且既有结构丢失拒绝伪报成功',async()=>{
 await expect(installScratchVersionGraph({query:async()=>({rows:[{name:'cecelia'}]})})).rejects.toMatchObject({code:'SCRATCH_REQUIRED'});
 expect((await installScratchVersionGraph(db,{schema,sourceSchema:source})).created).toBe(false);
 await db.query(`DROP TABLE ${schema}.execution_compositions`);
 await expect(installScratchVersionGraph(db,{schema,sourceSchema:source})).rejects.toMatchObject({code:'CATALOG_SCHEMA_DRIFT'});
});

it('同契约集合不足以通过：冻结槽位、顺序与完整字段须一致',async()=>{
 const original=(await db.query(`SELECT recipe FROM ${source}.workflow_production_recipes WHERE id=1`)).rows[0].recipe;
 const cases=[
  original.map((e,i)=>({...e,slot_key:i===0?'renamed':e.slot_key})),
  original.map((e,i)=>({...e,sequence_no:2-i})),
  [original[0]], [...original,{...original[0],slot_key:'extra',sequence_no:3}],
  [original[0],{...original[1],slot_key:'slot-a'}],
  ...['activity_id','activity_version_id','sequence_no','slot_key'].flatMap(key=>[
   original.map((e,i)=>i===0?Object.fromEntries(Object.entries(e).filter(([k])=>k!==key)):e),
   original.map((e,i)=>i===0?{...e,[key]:null}:e)
  ])
 ];
 for(const recipe of cases){await db.query(`UPDATE ${source}.workflow_production_recipes SET recipe=$1 WHERE id=1`,[JSON.stringify(recipe)]);await expect(compose()).rejects.toMatchObject({code:'23514'});}
 await db.query(`UPDATE ${source}.workflow_production_recipes SET recipe=$1,workflow_id=$2 WHERE id=1`,[JSON.stringify(original),uid()]);
 await expect(compose()).rejects.toMatchObject({code:'23514'});
 expect((await db.query(`SELECT count(*)::int n FROM ${schema}.execution_compositions`)).rows[0].n).toBe(0);
});

const addBuild=async({activity=ids.activity,contract=ids.av}={})=>{
 const build=uid();await db.query(`INSERT INTO ${source}.activity_definition_versions VALUES($1,$2)`,[build,activity]);
 await db.query(`INSERT INTO ${source}.activity_version_builds VALUES($1,$2,$3)`,[build,activity,contract]);
 const buildRef=await ref('activity_build',activity,build);
 const contractRef=(await db.query(`SELECT id FROM ${schema}.version_refs WHERE kind='activity_contract' AND source_version_id=$1`,[contract])).rows[0].id;
 await edge(buildRef,contractRef,'implements');await edge(buildRef,refs.skill,'uses_source');await seal(buildRef);return buildRef;
};
it('同Activity同契约的新构建生成新执行组合，旧Workflow与旧组合不变',async()=>{
 const old=(await compose()).rows[0],newBuild=await addBuild();
 const next=(await compose([{slot_key:'slot-a',build_ref:newBuild},{slot_key:'slot-b',build_ref:newBuild}])).rows[0];
 expect(next.composition_sha256).not.toBe(old.composition_sha256);
 expect(next.workflow_definition_id).toBe(old.workflow_definition_id);
 expect((await db.query(`SELECT composition_sha256 FROM ${schema}.execution_compositions WHERE id=$1`,[old.id])).rows[0].composition_sha256).toBe(old.composition_sha256);
 expect((await db.query(`SELECT count(*)::int n FROM ${source}.workflow_definition_versions`)).rows[0].n).toBe(1);
});
it('实际其他Activity或另一契约的有效构建也不能代替固定slot',async()=>{
 for(const otherActivity of [false,true]){
  const activity=otherActivity?uid():ids.activity,av=uid();await db.query(`INSERT INTO ${source}.activity_versions VALUES($1,$2)`,[av,activity]);
  const contractRef=await ref('activity_contract',activity,av);await seal(contractRef);
  const buildRef=await addBuild({activity,contract:av});
  await expect(compose([{slot_key:'slot-a',build_ref:buildRef},{slot_key:'slot-b',build_ref:refs.build}])).rejects.toMatchObject({code:'23514'});
 }
});
it('模型配置与实现代码各自换版只追加组合，不升级业务定义',async()=>{
 const old=(await compose()).rows[0],cfg=uid(),impl=uid();
 await db.query(`INSERT INTO ${schema}.agent_configuration_versions(id,agent_id,source_repo,source_path,source_commit,manifest_sha256,executor_kind,model_provider,model_name,actor)
 VALUES($1,$2,'owner/repo','agents/fixture.json','${'b'.repeat(40)}','${'b'.repeat(64)}','codex','openai','gpt-6.1-sol','fixture')`,[cfg,ids.agent]);
 await db.query(`INSERT INTO ${schema}.implementation_versions(id,component_id,source_repo,source_path,source_commit,artifact_sha256,actor)
 VALUES($1,$2,'owner/repo','scripts/run.js','${'b'.repeat(40)}','${'b'.repeat(64)}','fixture')`,[impl,ids.component]);
 const cfgRef=await ref('agent_configuration',ids.agent,cfg),implRef=await ref('implementation',ids.component,impl);await seal(cfgRef);await seal(implRef);
 ids.cfg=cfg;ids.impl=impl;const next=(await compose()).rows[0];
 expect(next.composition_sha256).not.toBe(old.composition_sha256);expect(next.workflow_definition_id).toBe(old.workflow_definition_id);
 expect((await db.query(`SELECT composition_sha256 FROM ${schema}.execution_compositions WHERE id=$1`,[old.id])).rows[0].composition_sha256).toBe(old.composition_sha256);
});
it('标记仍在而触发器、真实外键或防改函数漂移，安装必须报错',async()=>{
 for(const mutation of [
  `DROP TRIGGER immutable_version_graph ON ${schema}.version_edges`,
  `ALTER TABLE ${schema}.version_refs DROP CONSTRAINT version_refs_object_id_activity_contract_id_fkey`,
  `CREATE OR REPLACE FUNCTION ${schema}.reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`
 ]){
  const original=(await db.query("SELECT pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname='reject_history_change'",[schema])).rows[0].definition;
  await db.query(mutation);
  await expect(installScratchVersionGraph(db,{schema,sourceSchema:source})).rejects.toMatchObject({code:'CATALOG_SCHEMA_DRIFT'});
  if(mutation.startsWith('DROP TRIGGER'))await db.query(`CREATE TRIGGER immutable_version_graph BEFORE UPDATE OR DELETE OR TRUNCATE ON ${schema}.version_edges FOR EACH STATEMENT EXECUTE FUNCTION ${schema}.reject_history_change()`);
  else if(mutation.startsWith('ALTER TABLE'))await db.query(`ALTER TABLE ${schema}.version_refs ADD CONSTRAINT version_refs_object_id_activity_contract_id_fkey FOREIGN KEY(object_id,activity_contract_id) REFERENCES ${source}.activity_versions(activity_id,id)`);
  else await db.query(original);
  expect((await installScratchVersionGraph(db,{schema,sourceSchema:source})).created).toBe(false);
 }
});
it('并发追加依赖与封存串行化，封存后不会遗漏新边',async()=>{
 const impl=uid();await db.query(`INSERT INTO ${schema}.implementation_versions(id,component_id,source_repo,source_path,source_commit,artifact_sha256,actor)
 VALUES($1,$2,'owner/repo','concurrent.js','${'e'.repeat(40)}','${'f'.repeat(64)}','fixture')`,[impl,ids.component]);
 const consumer=await ref('implementation',ids.component,impl),second=await pool.connect();
 try{
  await db.query('BEGIN');await edge(consumer,refs.skill,'uses_source');
  const pending=second.query(`INSERT INTO ${schema}.version_seals(version_id,actor) VALUES($1,'concurrent') RETURNING dependency_sha256`,[consumer]);
  await db.query('COMMIT');const result=await pending;
  expect(result.rows[0].dependency_sha256).toMatch(/^[a-f0-9]{64}$/);
  await expect(edge(consumer,refs.impl,'executes_implementation')).rejects.toMatchObject({code:'23514'});
  expect((await db.query(`SELECT count(*)::int n FROM ${schema}.version_edges WHERE consumer_id=$1`,[consumer])).rows[0].n).toBe(1);
  const expected=(await db.query(`SELECT encode(sha256(convert_to(jsonb_agg(jsonb_build_object('dependency_id',dependency_id,'relation',relation) ORDER BY dependency_id,relation)::text,'UTF8')),'hex') digest FROM ${schema}.version_edges WHERE consumer_id=$1`,[consumer])).rows[0].digest;
  expect(result.rows[0].dependency_sha256).toBe(expected);
 }finally{await db.query('ROLLBACK');second.release();}
});
