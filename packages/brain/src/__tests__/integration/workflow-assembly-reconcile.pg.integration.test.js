import {it,expect,afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import {versionsDatabase,seedWorkflows} from '../fixtures/definition-versions-db.js';
import {migrationTable} from '../fixtures/minimum-definition-schema.js';
import {definitionDigest} from '../../workflow-authoring/contracts.js';
import {ensureVersionForBuild,refreshWorkflowRecipe} from '../../lib/release-line.js';
import * as api from '../../lib/workflow-assembly-reconcile.js';
let f;
afterEach(async()=>{await f?.close();f=null;});
async function fixture(){
 f=await versionsDatabase();await f.migrate();const db=f.db;
 await db.query('ALTER TABLE tasks ADD COLUMN result jsonb,ADD COLUMN tenant_id text,ADD COLUMN parent_task_id uuid,ADD COLUMN task_type text');
 await db.query(migrationTable('000_base_schema.sql','working_memory'));
 const id=randomUUID(),definition={key:'reconcile.fixture',source:{repo:'perfectuser21/cecelia',ref:'fixture.json',revision:'a'.repeat(40)},activities:[]};
 const digest=definitionDigest(definition),state={request:{assembly_mode:true,registration_protocol:'definition-freeze-v1',execution_protocol:'workflow-authoring-execution-v1'},outputs:{compose:{definition,definition_sha256:digest}}};
 await db.query("INSERT INTO tasks(id,title,status,tenant_id,task_type,payload,result) VALUES($1,'真实对账样板','completed','alpha','workflow_authoring',$2,$3)",[id,{workflow_authoring:true,tenant_id:'alpha'},{workflow_authoring:state}]);
 const pool=f.createPool(5);
 const readiness=extra=>({protocol:'workflow-authoring-execution-v1',status:'blocked',gaps:[{code:'execution_evidence_missing'}],tenant_id:'alpha',definition_sha256:digest,target_version:'candidate:'+digest,resource_condition:'ready',...extra});
 const run=options=>{expect(api.runWorkflowAssemblyReconcile).toBeTypeOf('function');return api.runWorkflowAssemblyReconcile(pool,{budgetMs:10000,readReadiness:async()=>readiness(),...options});};
 const saved=async()=> (await db.query('SELECT result FROM tasks WHERE id=$1',[id])).rows[0].result;
 return {db,id,digest,run,readiness,saved,pool};
}
async function frozenFixture(){
 const x=await fixture(),db=x.db;
 for(const t of ['activity_versions','activity_version_builds','activity_release_state','activity_release_events','workflow_production_recipes'])await db.query(migrationTable('541_release_line.sql',t));
 const wf=(await seedWorkflows(db)).keyword,activity=randomUUID(),reference=randomUUID();
 const original=(await db.query('SELECT result FROM tasks WHERE id=$1',[x.id])).rows[0].result;
 const definition=original.workflow_authoring.outputs.compose.definition;definition.activities=[{key:'render',name:'生成',executor_kind:'code',acceptance:['读回'],steps:[]}];
 const digest=definitionDigest(definition),source={repo:definition.source.repo,path:definition.source.ref,commit:definition.source.revision};
 await db.query("UPDATE workflows SET key=$2,status='paused',source_repo=$3,source_path=$4 WHERE id=$1",[wf,definition.key,source.repo,source.path]);
 await db.query("INSERT INTO activities(id,name,workflow_id,status) VALUES($1,'固定活动',$2,'planned')",[activity,wf]);
 const contract={...definition.activities[0],workflow_authoring:{workflow_key:definition.key,source:definition.source,runtime:definition.runtime??null}};
 const avPayload={activity_id:activity,contract,steps:[],implementation_bindings:[]};
 const av=(await db.query('INSERT INTO activity_definition_versions(activity_id,payload,contract_sha256,payload_sha256,source_repo,source_path,source_commit) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[activity,avPayload,definitionDigest(contract),definitionDigest({source,payload:avPayload}),source.repo,source.path,source.commit])).rows[0].id;
 const slots=[{slot_key:'render',sequence_no:1,reference_id:reference,activity_id:activity,activity_version_id:av}];
 const payload={workflow_id:wf,contract:definition,assembly_mode:true,activities:slots};
 const version=(await db.query('INSERT INTO workflow_definition_versions(workflow_id,payload,contract_sha256,payload_sha256,source_repo,source_path,source_commit) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[wf,payload,digest,definitionDigest({source,payload}),source.repo,source.path,source.commit])).rows[0].id;
 await db.query('UPDATE workflows SET current_definition_version_id=$2 WHERE id=$1',[wf,version]);
 await db.query('INSERT INTO workflow_activity_refs(id,workflow_id,slot_key,activity_id,activity_definition_version_id,sequence_no,source_repo,source_path,source_commit) VALUES($1,$2,\'render\',$3,$4,1,$5,$6,$7)',[reference,wf,activity,av,source.repo,source.path,source.commit]);
 await ensureVersionForBuild(db,av);await refreshWorkflowRecipe(db,wf);
 const owner={protocol:'workflow-authoring-execution-v1',authoring_task_id:x.id,tenant_id:'alpha',definition_sha256:digest,workflow_id:wf,workflow_definition_version_id:version,slots:[{slot_key:'render',activity_id:activity,activity_definition_version_id:av,steps:[]}]};
 original.workflow_authoring.outputs.compose={definition,definition_sha256:digest};original.workflow_authoring_candidate=owner;
 await db.query('UPDATE tasks SET result=$2 WHERE id=$1',[x.id,original]);
 const audit=async repair=>{expect(api.auditAssemblyDerivations).toBeTypeOf('function');return api.auditAssemblyDerivations(db,(await db.query('SELECT * FROM tasks WHERE id=$1',[x.id])).rows[0],{database:'cecelia_scratch',repair,check:()=>{}});};
 return {...x,digest,definition,wf,activity,reference,av,version,audit};
}
it('真实PG同数据库跨轮持锁；慢probe预算到期后不能晚建单或推进游标',async()=>{
 const x=await fixture();let clock=1000,release,started;
 const began=new Promise(r=>started=r),probe=new Promise(r=>release=r);
 const first=x.run({now:()=>clock,budgetMs:100,readReadiness:async()=>{started();return probe;}});
 await began;const second=await x.run({now:()=>clock,budgetMs:100});expect(second.skipped).toBe('locked');
 clock=1200;release(x.readiness());expect((await first).stopped).toBe('budget');
 expect((await x.saved()).workflow_assembly_reconcile).toBeUndefined();
 expect((await x.db.query('SELECT count(*)::int n FROM working_memory')).rows[0].n).toBe(0);
});
it('真实PG只处理显式新协议；不消费手填result proof或跨租户readiness',async()=>{
 const x=await fixture();await x.db.query("UPDATE tasks SET result=result||$2::jsonb WHERE id=$1",[x.id,{proof:{status:'verified',proof_sha256:'b'.repeat(64)}}]);
 await x.run({readReadiness:async()=>x.readiness({tenant_id:'beta',status:'verified',gaps:[],proof_sha256:'b'.repeat(64),verification_id:'b'.repeat(64)})});
 const state=(await x.saved()).workflow_assembly_reconcile;
 expect(state.status).not.toBe('verified');expect(Object.values(state.issues).some(i=>i.gap.code==='readiness_identity_mismatch')).toBe(true);
 await x.db.query("UPDATE tasks SET result=jsonb_set(result,'{workflow_authoring,request,assembly_mode}','false') WHERE id=$1",[x.id]);
 let called=0;await x.run({readReadiness:async()=>{called++;return x.readiness();}});expect(called).toBe(0);
});
it('真实PG资源safe_stop不建业务验证任务，未知恢复不放行，ready仍走同一原链',async()=>{
 const x=await fixture();let clock=1000;
 await x.run({now:()=>clock,readReadiness:async()=>x.readiness({resource_condition:'safe_stop'})});
 const before=(await x.saved()).workflow_assembly_reconcile;expect(before.status).toBe('waiting_resource');
 clock=2000;let called=0;await x.run({now:()=>clock,readReadiness:async()=>{called++;return x.readiness();}});expect(called).toBe(0);
 expect((await x.db.query('SELECT count(*)::int n FROM tasks')).rows[0].n).toBe(1);
 clock=100000;await x.run({now:()=>clock,readReadiness:async()=>x.readiness({resource_condition:'unknown'})});
 expect((await x.saved()).workflow_assembly_reconcile.status).toBe('waiting_resource');
 clock=1000000;await x.run({now:()=>clock});expect((await x.saved()).workflow_assembly_reconcile.status).toBe('open');
});
it('真实PG旧freeze+assembly标记不获得新执行授权，完全不调用readiness',async()=>{
 const x=await fixture();await x.db.query("UPDATE tasks SET result=jsonb_set(result,'{workflow_authoring,request}',(result#>'{workflow_authoring,request}')-'execution_protocol') WHERE id=$1",[x.id]);
 let called=0;await x.run({readReadiness:async()=>{called++;return x.readiness();}});
 expect(called).toBe(0);expect((await x.saved()).workflow_assembly_reconcile).toBeUndefined();
});
it('真实PG事务之前的扫描查询也受预算限制，不等锁释放才能退出',async()=>{
 const x=await fixture();await x.db.query('BEGIN');await x.db.query('LOCK TABLE working_memory IN ACCESS EXCLUSIVE MODE');
 let released=false;const timer=setTimeout(()=>{released=true;void x.db.query('ROLLBACK');},500);
 try{const out=await x.run({budgetMs:50});expect(out.stopped).toBe('budget');expect(released).toBe(false);}
 finally{clearTimeout(timer);await x.db.query('ROLLBACK');}
});
it('真实PG租户真列与payload冲突只报身份gap，不调用下游验真',async()=>{
 const x=await fixture();await x.db.query("UPDATE tasks SET payload=payload||'{\"tenant_id\":\"beta\"}' WHERE id=$1",[x.id]);
 let called=0;await x.run({readReadiness:async()=>{called++;return x.readiness();}});
 expect(called).toBe(0);expect(Object.values((await x.saved()).workflow_assembly_reconcile.issues).some(i=>i.gap.code==='readiness_identity_mismatch')).toBe(true);
});
it('真实PG首个定义嵌套损坏只记录结构gap，不饿死后续正常对象',async()=>{
 const x=await fixture(),bad='00000000-0000-4000-8000-000000000001';let definition={leaf:true};
 for(let i=0;i<45;i++)definition={child:definition};
 await x.db.query("INSERT INTO tasks(id,title,status,tenant_id,task_type,payload,result) SELECT $2,title,status,tenant_id,task_type,payload,jsonb_set(result,'{workflow_authoring,outputs,compose,definition}',$3) FROM tasks WHERE id=$1",[x.id,bad,definition]);
 const out=await x.run();expect(out.errors).toBe(1);expect(out.checked).toBe(1);
 const state=(await x.db.query('SELECT result FROM tasks WHERE id=$1',[bad])).rows[0].result.workflow_assembly_reconcile;
 expect(state.structural_gaps).toContainEqual({code:'definition_invalid'});
 expect((await x.saved()).workflow_assembly_reconcile.checked_at).toBeTypeOf('number');
});
it('真实PG缺失固定引用与配方报红；仅同原reference_id补齐，生产指针不变',async()=>{
 const x=await frozenFixture();await x.db.query('DELETE FROM workflow_activity_refs WHERE id=$1',[x.reference]);await x.db.query('DELETE FROM workflow_production_recipes WHERE workflow_id=$1',[x.wf]);
 const before=await x.audit(false);expect(before.gaps.map(g=>g.code)).toEqual(expect.arrayContaining(['fixed_reference_missing','recipe_missing']));
 const repaired=await x.audit(true);expect(repaired.repaired.length).toBeGreaterThan(0);expect(repaired.gaps).toEqual([]);
 expect((await x.db.query('SELECT id,activity_definition_version_id FROM workflow_activity_refs WHERE workflow_id=$1',[x.wf])).rows).toEqual([{id:x.reference,activity_definition_version_id:x.av}]);
 expect((await x.db.query('SELECT count(*)::int n FROM activity_release_state')).rows[0].n).toBe(0);
});
it('真实PG inactive人工引用、篡改owner、非scratch环境都不自动覆写',async()=>{
 const x=await frozenFixture();await x.db.query('UPDATE workflow_activity_refs SET active=false WHERE id=$1',[x.reference]);
 expect((await x.audit(true)).gaps.some(g=>g.code==='fixed_reference_conflict')).toBe(true);
 expect((await x.db.query('SELECT active FROM workflow_activity_refs WHERE id=$1',[x.reference])).rows[0].active).toBe(false);
 await x.db.query("UPDATE tasks SET result=jsonb_set(result,'{workflow_authoring_candidate,authoring_task_id}',to_jsonb($2::text)) WHERE id=$1",[x.id,randomUUID()]);
 expect((await x.audit(true)).repaired).toEqual([]);
 const row=(await x.db.query('SELECT * FROM tasks WHERE id=$1',[x.id])).rows[0];
 expect((await api.auditAssemblyDerivations(x.db,row,{database:'cecelia',repair:true,check:()=>{}})).gaps).toContainEqual({code:'candidate_environment_unsupported'});
});
it('真实PG外层事务中后发现人工冲突，必须回滚此前本次派生修复',async()=>{
 const x=await frozenFixture();await x.db.query('DELETE FROM activity_version_builds WHERE build_id=$1',[x.av]);
 await x.db.query('UPDATE workflow_activity_refs SET active=false WHERE id=$1',[x.reference]);
 const row=(await x.db.query('SELECT * FROM tasks WHERE id=$1',[x.id])).rows[0];
 await x.db.query('BEGIN');
 try{const out=await api.auditAssemblyDerivations(x.db,row,{database:'cecelia_scratch',repair:true,transaction:'existing',check:()=>{}});
   expect(out.gaps).toContainEqual({code:'fixed_reference_conflict'});await x.db.query('COMMIT');}
 catch(error){await x.db.query('ROLLBACK');throw error;}
 expect((await x.db.query('SELECT count(*)::int n FROM activity_version_builds WHERE build_id=$1',[x.av])).rows[0].n).toBe(0);
});
it('真实PG已active候选和退休Activity不自动修复派生关系',async()=>{
 const x=await frozenFixture();await x.db.query('DELETE FROM workflow_activity_refs WHERE id=$1',[x.reference]);
 await x.db.query("UPDATE workflows SET status='active' WHERE id=$1",[x.wf]);
 expect((await x.audit(true)).repaired).toEqual([]);
 await x.db.query("UPDATE workflows SET status='paused' WHERE id=$1",[x.wf]);
 await x.db.query("UPDATE activities SET status='deprecated' WHERE id=$1",[x.activity]);
 expect((await x.audit(true)).repaired).toEqual([]);
 expect((await x.db.query('SELECT count(*)::int n FROM workflow_activity_refs WHERE workflow_id=$1',[x.wf])).rows[0].n).toBe(0);
});
