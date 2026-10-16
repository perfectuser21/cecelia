import {it,expect,afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import {versionsDatabase} from '../fixtures/definition-versions-db.js';
import {migrationTable} from '../fixtures/minimum-definition-schema.js';
import {definitionDigest} from '../../workflow-authoring/contracts.js';
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
