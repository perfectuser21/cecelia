import {versionsDatabase} from '../fixtures/definition-versions-db.js';
import {migrationTable} from '../fixtures/minimum-definition-schema.js';
import {submitAuthoring} from '../../workflow-authoring/store.js';
import {registerWorkflow,validateReferences,registrationDigest} from '../../workflow-authoring/registration.js';
export const ASSEMBLY_TABLES=['workflows','activities','steps','workflow_activity_refs','warehouse_items','activity_uses','activity_definition_versions','workflow_definition_versions','activity_versions','activity_version_builds','activity_release_state','activity_release_events','workflow_production_recipes','tasks'];
const schema=(...names)=>({type:'object',properties:Object.fromEntries(names.map(n=>[n,{type:'string'}])),required:names});
export async function assemblyDatabase(){
 const f=await versionsDatabase();
 try{
  await f.migrate();const db=f.db;
  await db.query(migrationTable('283_skill_registry_and_journey_step_links.sql','skill_registry'));
  await db.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS claimed_by text,ADD COLUMN IF NOT EXISTS result jsonb');
  await db.query(`ALTER TABLE warehouse_items ADD COLUMN shelf text,ADD COLUMN source_table text,ADD COLUMN source_ref text;
   ALTER TABLE activities ADD COLUMN inputs jsonb,ADD COLUMN outputs jsonb,ADD COLUMN preconditions jsonb,ADD COLUMN invariants jsonb,ADD COLUMN nfr jsonb,ADD COLUMN failure jsonb,ADD COLUMN readback jsonb;`);
  for(const table of ['activity_versions','activity_version_builds','activity_release_state','activity_release_events','workflow_production_recipes'])await db.query(migrationTable('541_release_line.sql',table));
  const cap=randomUUID(),skill=randomUUID(),vs=randomUUID();
  await db.query("INSERT INTO value_streams(id,name) VALUES($1,'隔离装配价值流')",[vs]);
  await db.query("INSERT INTO capabilities(id,name,parent_journey_id,status) VALUES($1,'隔离装配能力',$2,'active')",[cap,vs]);
  await db.query("INSERT INTO skill_registry(id,name,location,status) VALUES($1,'assembly-fixture','/fixture/SKILL.md','active')",[skill]);
  const documents=new Map();
  function definition(key='assembly.report',revision='a'.repeat(40)){
   return {key,name:'隔离装配报告',capability_id:cap,channel:'internal',form:'code',version:'1.0.0',source:{repo:'perfectuser21/cecelia',ref:`contracts/${key}.json`,revision},
    runtime:{skill_id:skill,entrypoint:'report',transport:'script'},input_schema:schema('topic'),output_schema:schema('report'),
    warehouse_items:[{key:'assembly.renderer',name:'报告渲染器',kind:'code',shelf:'generic_action',impl_ref:'src/render.js'}],
    activities:[{key:'render',name:'生成报告',executor_kind:'code',acceptance:['读回报告'],input_schema:schema('topic'),output_schema:schema('report'),
     implementation:{kind:'code',ref:'src/render.js',version:'1.0.0',repo:'perfectuser21/cecelia',path:'src/render.js',revision:'contract'},
     warehouse_dependencies:[{key:'assembly.renderer'}],steps:[{key:'read',name:'读回',reads:['topic'],writes:['report'],dod:{readback:{type:'sql',query:'SELECT 1'}}}]}]};
  }
  async function submit(d,{operation='create',expectedVersion,workflowId}={}){
   const {source,...document}=d;documents.set(`${source.revision}:${source.ref}`,JSON.stringify(document));
   const id=randomUUID(),state={schema_version:1,stage:'register',revision:5,request:{operation,actor:'fixture:assembly',goal:'隔离验收',registration_protocol:'definition-freeze-v1',assembly_mode:true,expected_version:expectedVersion},outputs:{compose:{definition:d,definition_sha256:registrationDigest(d)},intake:{workflow_id:workflowId}},receipts:[]};
   await db.query("INSERT INTO tasks(id,title,status,claimed_by,payload,result) VALUES($1,'隔离装配验收','in_progress','fixture', $2,$3)",[id,{workflow_authoring:true},{workflow_authoring:state}]);
   const body={stage:'register',revision:5,submission_id:'register-1',output:{}};
   const deps={registerWorkflow,validateReferences,freezeOptions:{readFile:async s=>documents.get(`${s.revision}:${s.path}`)??'export const render = true;'}};
   return {id,run:()=>submitAuthoring(db,id,body,deps)};
  }
  async function snapshot(){const out={};for(const table of ASSEMBLY_TABLES)out[table]=(await db.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows.map(x=>x.row);return out;}
  return {...f,definition,submit,snapshot,documents};
 }catch(e){await f.close();throw e;}
}

import {afterEach,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {implementationImpactDatabase} from '../fixtures/implementation-impact-db.js';
import {refreshWorkflowRecipe,ensureVersionForBuild} from '../../lib/release-line.js';
let f;afterEach(async()=>{await f?.close();f=null;});
it('真实PG重复装配保持树仓库用料步骤与版本身份；完整合同拆列和静态计划一致，候选不启用生产',async()=>{
 f=await assemblyDatabase();const d=f.definition(),a=await f.submit(d);const first=await a.run();
 expect(first.receipt.output).toMatchObject({assembly_mode:true,callable:false,readback_verified:true,assembly_plan:{structurally_complete:true}});
 const state=await f.snapshot();expect(state.activity_uses).toHaveLength(1);expect(state.steps).toHaveLength(1);expect(state.activity_versions).toHaveLength(1);
 expect(state.activities[0].inputs).toEqual(d.activities[0].input_schema);expect(state.activities[0].outputs).toEqual(d.activities[0].output_schema);
 expect(state.activity_release_state).toHaveLength(0);expect(state.activity_release_events).toHaveLength(0);
 await a.run();expect(await f.snapshot()).toEqual(state);
 const b=await f.submit(d);await b.run();const second=await f.snapshot();for(const table of ['activities','steps','warehouse_items','activity_uses','activity_definition_versions','workflow_definition_versions','workflow_production_recipes'])expect(second[table],table).toEqual(state[table]);
});
it.each(['activity_uses','activity_version_builds','workflow_production_recipes'])('真实PG %s 故障使所有树、版本、用料及阶段回执整笔回滚，恢复重试不重复',async table=>{
 f=await assemblyDatabase();const a=await f.submit(f.definition());
 await f.db.query(`CREATE FUNCTION reject_assembly_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_assembly_failure'; END $$;CREATE TRIGGER reject_assembly_write BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_assembly_write()`);
 const before=await f.snapshot();await expect(a.run()).rejects.toThrow('injected_assembly_failure');expect(await f.snapshot()).toEqual(before);
 await f.db.query(`DROP TRIGGER reject_assembly_write ON ${table}`);await a.run();expect((await f.snapshot()).workflow_production_recipes).toHaveLength(1);
});
it('同key仓库未知归属和同物件多角色全部拒绝，不认领人工物件',async()=>{
 f=await assemblyDatabase();await f.db.query("INSERT INTO warehouse_items(key,name,kind,shelf,impl_ref) VALUES('assembly.renderer','人工渲染器','code','generic_action','manual.js')");
 const a=await f.submit(f.definition()),before=await f.snapshot();await expect(a.run()).rejects.toThrow(/仓库/);expect(await f.snapshot()).toEqual(before);
 await f.db.query("DELETE FROM warehouse_items WHERE key='assembly.renderer'");const d=f.definition();d.activities[0].warehouse_dependencies.push({key:'assembly.renderer',role:'depends'});const b=await f.submit(d),baseline=await f.snapshot();await expect(b.run()).rejects.toThrow(/角色冲突/);expect(await f.snapshot()).toEqual(baseline);
});
it('两个Workflow固定复用同一Activity；拥有者升级不改旧消费者、共享版本或人工用料',async()=>{
 f=await assemblyDatabase();const owner=f.definition(),a=await f.submit(owner);const registered=(await a.run()).receipt.output;
 const activity=(await f.db.query('SELECT * FROM activities WHERE id=$1',[registered.activity_ids[0]])).rows[0];
 const version=(await f.db.query('SELECT * FROM activity_definition_versions WHERE id=$1',[activity.current_definition_version_id])).rows[0];
 const consumer=f.definition('assembly.consumer','b'.repeat(40));delete consumer.warehouse_items;
 consumer.activities=[{...owner.activities[0],key:'reuse',reuse_activity_id:activity.id,reuse_activity_definition_version_id:version.id,reuse_contract_sha256:version.contract_sha256}];
 const b=await f.submit(consumer);const consumerResult=(await b.run()).receipt.output;
 expect((await f.db.query('SELECT * FROM activities WHERE id=$1',[activity.id])).rows[0]).toEqual(activity);
 const manual=randomUUID();await f.db.query("INSERT INTO warehouse_items(id,key,name,kind,shelf) VALUES($1,'manual.extra','人工用料','code','generic_action')",[manual]);await f.db.query('INSERT INTO activity_uses(activity_id,item_id,assertion_ref) VALUES($1,$2,\'manual:keep\')',[activity.id,manual]);
 const old=(await f.db.query('SELECT * FROM workflow_activity_refs WHERE workflow_id=$1',[consumerResult.workflow_id])).rows;
 const upgrade=structuredClone(owner);upgrade.version='1.1.0';upgrade.source.revision='c'.repeat(40);upgrade.activities[0].acceptance.push('新版报告');const c=await f.submit(upgrade,{operation:'update',expectedVersion:'1.0.0',workflowId:registered.workflow_id});await c.run();
 expect((await f.db.query('SELECT * FROM workflow_activity_refs WHERE workflow_id=$1',[consumerResult.workflow_id])).rows).toEqual(old);
 expect((await f.db.query('SELECT * FROM activity_definition_versions WHERE id=$1',[version.id])).rows[0]).toEqual(version);
 expect((await f.db.query('SELECT assertion_ref FROM activity_uses WHERE item_id=$1',[manual])).rows[0].assertion_ref).toBe('manual:keep');
 const newest=(await f.db.query('SELECT * FROM activity_definition_versions WHERE id=(SELECT current_definition_version_id FROM activities WHERE id=$1)',[activity.id])).rows[0];
 const latestMapping=(await f.db.query('SELECT activity_version_id FROM activity_version_builds WHERE build_id=$1',[newest.id])).rows[0];
 await f.db.query('INSERT INTO activity_release_state(activity_id,production_version_id) VALUES($1,$2)',[activity.id,latestMapping.activity_version_id]);
 const recipeBefore=(await f.db.query('SELECT * FROM workflow_production_recipes WHERE workflow_id=$1',[consumerResult.workflow_id])).rows;
 await refreshWorkflowRecipe(f.db,consumerResult.workflow_id);
 expect((await f.db.query('SELECT * FROM workflow_production_recipes WHERE workflow_id=$1',[consumerResult.workflow_id])).rows).toEqual(recipeBefore);
 const two=structuredClone(consumer);two.key='assembly.two';two.source.ref='contracts/assembly.two.json';two.output_mapping={report:'$activity.old.report'};
 two.activities=[{...consumer.activities[0],key:'old'},{...consumer.activities[0],key:'new',reuse_activity_definition_version_id:newest.id,reuse_contract_sha256:newest.contract_sha256}];
 const pair=await f.submit(two);const pairReceipt=(await pair.run()).receipt.output;
 expect((await f.db.query('SELECT activity_definition_version_id FROM workflow_activity_refs WHERE workflow_id=$1 AND active ORDER BY sequence_no',[pairReceipt.workflow_id])).rows.map(r=>r.activity_definition_version_id)).toEqual([version.id,newest.id]);
 const secondConsumer=structuredClone(consumer);secondConsumer.key='assembly.consumer2';secondConsumer.source.ref='contracts/assembly.consumer2.json';const reused=await f.submit(secondConsumer);await reused.run();
 const bad=structuredClone(consumer);bad.key='assembly.bad';bad.source.ref='contracts/assembly.bad.json';bad.activities[0].reuse_contract_sha256=registrationDigest({bad:true});const rejected=await f.submit(bad),before=await f.snapshot();await expect(rejected.run()).rejects.toThrow(/共享/);expect(await f.snapshot()).toEqual(before);
});
it('最终阶段回执写入失败也回滚所有装配；租户不匹配不产生任何候选',async()=>{
 f=await assemblyDatabase();const a=await f.submit(f.definition());
 await f.db.query("CREATE FUNCTION reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'receipt_failed'; END $$;CREATE TRIGGER reject_receipt BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION reject_receipt()");
 const before=await f.snapshot();await expect(a.run()).rejects.toThrow('receipt_failed');expect(await f.snapshot()).toEqual(before);
 await f.db.query('DROP TRIGGER reject_receipt ON tasks');const d=f.definition('assembly.foreign');d.tenant_id='foreign';const b=await f.submit(d),baseline=await f.snapshot();await expect(b.run()).rejects.toThrow(/tenant_mismatch/);expect(await f.snapshot()).toEqual(baseline);
});
it('已有未知来源Workflow即使key和预期版本相同也不得认领覆盖',async()=>{
 f=await assemblyDatabase();const d=f.definition();const id=randomUUID();await f.db.query("INSERT INTO workflows(id,key,name,capability_id,channel,form,version,status) VALUES($1,$2,'人工流程',$3,'internal','code','0.9.0','active')",[id,d.key,d.capability_id]);
 const a=await f.submit(d,{operation:'update',workflowId:id,expectedVersion:'0.9.0'}),before=await f.snapshot();await expect(a.run()).rejects.toThrow(/未知工作流来源/);expect(await f.snapshot()).toEqual(before);
});
it('回执存在不能掩盖活动合同已被未知来源替换；拒绝写回覆盖',async()=>{
 f=await assemblyDatabase();const d=f.definition(),a=await f.submit(d),r=(await a.run()).receipt.output;
 await f.db.query('UPDATE activities SET contract=$2 WHERE id=$1',[r.activity_ids[0],{manual:'unknown'}]);
 const b=await f.submit(d),before=await f.snapshot();await expect(b.run()).rejects.toThrow(/合同或来源/);expect(await f.snapshot()).toEqual(before);
});

it('外部合同同步也消费同一合同列和显式用料服务，不把实现绑定变成隐式用料',async()=>{
 f=await implementationImpactDatabase();
 await f.db.query('ALTER TABLE activities ADD COLUMN inputs jsonb,ADD COLUMN outputs jsonb,ADD COLUMN preconditions jsonb,ADD COLUMN invariants jsonb,ADD COLUMN nfr jsonb,ADD COLUMN failure jsonb,ADD COLUMN readback jsonb');
 await f.db.query("INSERT INTO warehouse_items(key,name,kind) VALUES('external.renderer','现有渲染器','code')");
 const contract=f.contracts.docs.keyword_acquisition.activities[0];contract.inputs=[{fields:['topic']}];contract.outputs=[{fields:['report']}];contract.warehouse_dependencies=[{key:'external.renderer',role:'depends'}];
 await f.sync('b'.repeat(40));
 const rows=(await f.db.query("SELECT a.inputs,a.outputs,u.role FROM activities a JOIN activity_uses u ON u.activity_id=a.id JOIN warehouse_items w ON w.id=u.item_id WHERE w.key='external.renderer'")).rows;
 expect(rows).toEqual([{inputs:contract.inputs,outputs:contract.outputs,role:'depends'}]);
 expect((await f.db.query('SELECT count(*)::int n FROM activity_uses')).rows[0].n).toBe(1);
});
it('旧共享版本有Step合同但缺固定Step登记身份时拒绝复用，不复制补写共享真身',async()=>{
 f=await assemblyDatabase();const owner=f.definition(),a=await f.submit(owner),r=(await a.run()).receipt.output;
 const activity=(await f.db.query('SELECT * FROM activities WHERE id=$1',[r.activity_ids[0]])).rows[0];
 const original=(await f.db.query('SELECT * FROM activity_definition_versions WHERE id=$1',[activity.current_definition_version_id])).rows[0];
 const payload=structuredClone(original.payload);payload.steps[0].step_id=null;
 const v=(await f.db.query(`INSERT INTO activity_definition_versions(activity_id,payload,payload_sha256,source_repo,source_path,source_commit,contract_sha256)
 VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[activity.id,payload,registrationDigest({source:{repo:original.source_repo,path:original.source_path,commit:original.source_commit},payload}),original.source_repo,original.source_path,original.source_commit,original.contract_sha256])).rows[0];
 await ensureVersionForBuild(f.db,v.id);
 const d=f.definition('assembly.incomplete');delete d.warehouse_items;d.activities=[{...owner.activities[0],reuse_activity_id:activity.id,reuse_activity_definition_version_id:v.id,reuse_contract_sha256:v.contract_sha256}];
 const b=await f.submit(d),before=await f.snapshot();await expect(b.run()).rejects.toThrow(/Step固定登记/);expect(await f.snapshot()).toEqual(before);
});
