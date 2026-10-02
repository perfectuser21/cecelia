import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createIntakeTestDatabase } from '../fixtures/task-intake-db.js';
import { createJanitor } from '../../janitor.js';
import { createStore } from '../../../../../scripts/brain-image-retention/storage.mjs';
import { createRetentionEngine } from '../../../../../scripts/brain-image-retention/engine.mjs';
import { POLICY, US_MACHINE_ID } from '../../../../../scripts/brain-image-retention/policy.mjs';
let fixture,pool,createImageRetentionController;
const GiB=2**30,image=n=>'sha256:'+String(n).repeat(64);
beforeAll(async()=>{
 ({createImageRetentionController}=await import('../../image-retention-controller.js').catch(()=>({})));
 expect(createImageRetentionController).toBeTypeOf('function');
 fixture=await createIntakeTestDatabase();pool=fixture.pool;
 for(const file of ['272_janitor.sql','502_preview_owned_cache_janitor.sql','510_us_brain_image_retention.sql'])await pool.query(await readFile(new URL('../../../migrations/'+file,import.meta.url),'utf8'));
});
afterAll(async()=>fixture?.close());
async function setup(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'image-janitor-pg-'))),store=createStore(root),now=Date.now();
 const state={ids:[1,2,3,4,5],calls:[],available:10*GiB,unknown:false,lose:false};
 await store.withLock(lease=>store.save('ledger.json',{schema_version:1,generation:1,pending:null,successes:[1,2,3].map(n=>({deployment_id:randomUUID(),image_id:image(n),version:`1.0.${n}`,git_sha:'a'.repeat(40),confirmed_at:new Date(now-n*1000).toISOString()}))},lease));
 const docker={snapshot:async()=>({machine_registry_id:US_MACHINE_ID,daemon_id:'pg-fixture',docker_root_dir:'/mnt/data/docker',volume_dev:1,observed_at:new Date().toISOString(),disk:{total_bytes:100*GiB,available_bytes:state.available},
  images:state.ids.map(n=>({id:image(n),tags:[`cecelia-brain:1.0.${n}`],digests:[`cecelia-brain@${image(n)}`],created_at:new Date(now-2*86400000).toISOString()})),containers:[{id:'a'.repeat(64),image_id:image(1),name:'/cecelia-node-brain',running:true}]}),
  remove:async id=>{state.calls.push(id);const row=(await pool.query("SELECT t.status FROM tasks t JOIN janitor_image_intents j ON j.task_id=t.id WHERE j.request->>'image_id'=$1 ORDER BY j.created_at DESC LIMIT 1",[id])).rows[0];expect(row.status).toBe('in_progress');if(!state.unknown){state.ids=state.ids.filter(n=>image(n)!==id);state.available+=6*GiB;}}};
 const engine=createRetentionEngine({store,docker});
 const transport={...engine,execute:async r=>{const result=await engine.execute(r);if(state.lose)throw Error('lost response');return result;}};
 const controller=createImageRetentionController({pool,engine:transport});
 const api=createJanitor([{JOB_ID:POLICY,JOB_NAME:'US镜像清理',run:controller.run,reconcile:controller.reconcile}]);
 return {store,state,engine,controller,api,close:()=>rm(root,{recursive:true,force:true})};
}
it('迁移默认停用，明确启用后两项真实任务/路由收据/文件回执同一完整ID闭环',async()=>{
 const f=await setup();try{
  await expect(f.api.runJob(pool,POLICY)).rejects.toMatchObject({code:'JANITOR_DISABLED'});expect(f.state.calls).toEqual([]);
  await f.api.setJobConfig(pool,POLICY,{enabled:true});const result=await f.api.runJob(pool,POLICY);expect(result.status).toBe('success');
  const rows=(await pool.query('SELECT t.*,j.receipt,r.work_kind FROM tasks t JOIN janitor_image_intents j ON j.task_id=t.id JOIN work_routing_receipts r ON r.task_id=t.id WHERE j.run_id=$1',[result.run_id])).rows;
  expect(rows).toHaveLength(2);expect(f.state.calls).toEqual([image(4),image(5)]);
  for(const row of rows){expect(row).toMatchObject({status:'completed',task_type:'janitor',executor_kind:'image-janitor',work_kind:'operations'});expect(row.result).toMatchObject({actor:'janitor:us-brain-image-retention',receipt:{evidence:{absent:true},task_id:row.id}});}
  expect(result.freed_bytes).toBe(12*GiB);
 }finally{await f.close();}
});
it('删除响应丢失保留原任务，只读reconcile补完成且不启动第二项',async()=>{
 const f=await setup();f.state.lose=true;try{
  await expect(f.api.runJob(pool,POLICY)).rejects.toMatchObject({code:'JANITOR_UNCONFIRMED'});
  const run=(await pool.query("SELECT id FROM janitor_runs WHERE job_id=$1 AND status='running'",[POLICY])).rows[0];
  expect((await pool.query('SELECT t.status FROM tasks t JOIN janitor_image_intents j ON j.task_id=t.id WHERE j.run_id=$1',[run.id])).rows[0].status).toBe('blocked');
  await f.api.setJobConfig(pool,POLICY,{enabled:false});expect((await f.api.reconcileJob(pool,POLICY)).status).toBe('success');expect(f.state.calls).toHaveLength(1);
 }finally{await f.close();}
});
it('未知删除持续占位，错误task回执拒收，身份正确精确缺失后才结算',async()=>{
 const f=await setup();f.state.unknown=true;try{
  await f.api.setJobConfig(pool,POLICY,{enabled:true});await expect(f.api.runJob(pool,POLICY)).rejects.toMatchObject({code:'JANITOR_UNCONFIRMED'});
  await expect(f.api.reconcileJob(pool,POLICY)).rejects.toMatchObject({code:'JANITOR_UNCONFIRMED'});expect(f.state.calls).toHaveLength(1);
  const row=(await pool.query('SELECT * FROM janitor_image_intents WHERE settled_at IS NULL ORDER BY created_at DESC LIMIT 1')).rows[0];
  await expect(pool.query("UPDATE janitor_image_intents SET request='{}' WHERE task_id=$1",[row.task_id])).rejects.toThrow();
  await pool.query("UPDATE tasks SET payload='{}' WHERE id=$1",[row.task_id]);f.state.ids=f.state.ids.filter(n=>image(n)!==row.request.image_id);
  const broken=createImageRetentionController({pool,engine:{...f.engine,receipt:async id=>({...await f.engine.receipt(id),task_id:randomUUID()})}});
  expect((await broken.reconcile({run_id:row.run_id})).status).toBe('unconfirmed');
  expect((await f.api.reconcileJob(pool,POLICY)).status).toBe('success');expect(f.state.calls).toHaveLength(1);
 }finally{await f.close();}
});
