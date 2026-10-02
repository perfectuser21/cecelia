import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import janitorRouter from '../../routes/janitor.js';
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
 const docker={absent:async id=>!state.ids.some(n=>image(n)===id),snapshot:async()=>({machine_registry_id:US_MACHINE_ID,daemon_id:'pg-fixture',docker_root_dir:'/mnt/data/docker',volume_dev:1,observed_at:new Date().toISOString(),disk:{total_bytes:100*GiB,available_bytes:state.available},
  images:state.ids.map(n=>({id:image(n),tags:[`cecelia-brain:1.0.${n}`],digests:[`cecelia-brain@${image(n)}`],created_at:new Date(now-2*86400000).toISOString()})),containers:[{id:'a'.repeat(64),image_id:image(1),name:'/cecelia-node-brain',running:true}]}),
  remove:async id=>{state.calls.push(id);const row=(await pool.query("SELECT t.status FROM tasks t JOIN janitor_image_intents j ON j.task_id=t.id WHERE j.request->>'image_id'=$1 ORDER BY j.created_at DESC LIMIT 1",[id])).rows[0];expect(row.status).toBe('in_progress');if(!state.unknown){state.ids=state.ids.filter(n=>image(n)!==id);state.available+=6*GiB;}}};
 const engine=createRetentionEngine({store,docker});
 const transport={...engine,execute:async r=>{const result=await engine.execute(r);if(state.lose)throw Error('lost response');return result;}};
 const controller=createImageRetentionController({pool,engine:transport});
 const api=createJanitor([{JOB_ID:POLICY,JOB_NAME:'US镜像清理',run:controller.run,reconcile:controller.reconcile}]);
 return {store,state,engine,controller,api,close:()=>rm(root,{recursive:true,force:true})};
}
it('正式HTTP入口列出默认关闭US策略，传入镜像字段也不能绕过关闭闸',async()=>{
 const app=express();app.use(express.json());app.locals.pool=pool;app.use('/api/brain/janitor',janitorRouter);
 const jobs=await request(app).get('/api/brain/janitor/jobs');expect(jobs.status).toBe(200);
 expect(jobs.body.jobs.find(x=>x.id===POLICY)).toMatchObject({enabled:false});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try {const result=await promisify(execFile)('bash',[fileURLToPath(new URL('../../../scripts/smoke/us-image-retention-smoke.sh',import.meta.url))],{env:{...process.env,BRAIN_URL:'http://127.0.0.1:'+server.address().port}});expect(result.stdout).toContain('[us-image-retention-smoke] PASS');}
 finally {await new Promise(resolve=>server.close(resolve));}
 const denied=await request(app).post('/api/brain/janitor/jobs/'+POLICY+'/run').send({image_id:image(4),enabled:true});
 expect(denied.status).toBe(409);expect(denied.body.error).toBe('JANITOR_DISABLED');
 expect((await pool.query('SELECT count(*)::int AS n FROM janitor_image_intents')).rows[0].n).toBe(0);
});
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
it('任务预约落库后尚未调用引擎就断线，关闭后只读对账不补执行',async()=>{
 const f=await setup();try{
  const broken=createImageRetentionController({pool,engine:{...f.engine,execute:async()=>{throw Error('disconnected before execute');}}});
  const api=createJanitor([{JOB_ID:POLICY,JOB_NAME:'fixture',run:broken.run,reconcile:broken.reconcile}]);
  await expect(api.runJob(pool,POLICY)).rejects.toMatchObject({code:'JANITOR_UNCONFIRMED'});
  await api.setJobConfig(pool,POLICY,{enabled:false});expect((await f.api.reconcileJob(pool,POLICY)).status).toBe('skipped');
  expect(f.state.calls).toHaveLength(0);
  const row=(await pool.query('SELECT t.status,j.receipt FROM tasks t JOIN janitor_image_intents j ON j.task_id=t.id ORDER BY j.created_at DESC LIMIT 1')).rows[0];
  expect(row.status).toBe('failed');expect(row.receipt).toMatchObject({status:'skipped',attempted:false});
 }finally{await f.close();}
});
it('两个controller并发认领只创建一任务，回执封存后不可覆写',async()=>{
 const f=await setup();try{
  const run_id=randomUUID();await pool.query("INSERT INTO janitor_runs(id,job_id,job_name,status) VALUES($1,$2,'fixture','running')",[run_id,POLICY]);
  const plan=await f.engine.plan(run_id);const [a,b]=await Promise.all([f.controller.claim(plan,plan.images[0].id),f.controller.claim(plan,plan.images[0].id)]);
  expect(a.task_id).toBe(b.task_id);expect(a.request.intent_id).toBe(b.request.intent_id);
  expect((await f.controller.reconcile({run_id})).status).toBe('skipped');expect(f.state.calls).toHaveLength(0);
  await expect(pool.query("UPDATE janitor_image_intents SET receipt='{}' WHERE task_id=$1",[a.task_id])).rejects.toThrow();
  await pool.query("UPDATE janitor_runs SET status='skipped' WHERE id=$1",[run_id]);
 }finally{await f.close();}
});
it('终态事务已提交后COMMIT回执丢失，对账不新增任务或重删',async()=>{
 const f=await setup();let injected=false;
 const proxy={query:(...a)=>pool.query(...a),connect:async()=>{
  const c=await pool.connect();let sealing=false;
  return {release:(...a)=>c.release(...a),query:async(...a)=>{
   if(String(a[0]).startsWith('UPDATE janitor_image_intents SET receipt='))sealing=true;
   const result=await c.query(...a);
   if(a[0]==='COMMIT'&&sealing&&!injected){injected=true;throw Error('committed response lost');}
   return result;
  }};
 }};
 try{
  const controller=createImageRetentionController({pool:proxy,engine:f.engine});
  const api=createJanitor([{JOB_ID:POLICY,JOB_NAME:'fixture',run:controller.run,reconcile:controller.reconcile}]);
  await api.setJobConfig(pool,POLICY,{enabled:true});
  await expect(api.runJob(pool,POLICY)).rejects.toMatchObject({code:'JANITOR_UNCONFIRMED'});expect(injected).toBe(true);
  const run=(await pool.query("SELECT id FROM janitor_runs WHERE job_id=$1 AND status='running'",[POLICY])).rows[0];
  const rows=(await pool.query('SELECT t.status,j.settled_at FROM tasks t JOIN janitor_image_intents j ON j.task_id=t.id WHERE j.run_id=$1',[run.id])).rows;
  expect(rows).toHaveLength(1);expect(rows[0].status).toBe('completed');expect(rows[0].settled_at).not.toBeNull();
  await api.setJobConfig(pool,POLICY,{enabled:false});expect((await api.reconcileJob(pool,POLICY)).status).toBe('success');
  expect(f.state.calls).toHaveLength(1);expect((await pool.query('SELECT count(*)::int n FROM janitor_image_intents WHERE run_id=$1',[run.id])).rows[0].n).toBe(1);
 }finally{await f.close();}
});
it('回执身份/actor/完整绑定任一漂移都不结算，原回执随后可恢复',async()=>{
 const f=await setup();f.state.unknown=true;
 try{
  await f.api.setJobConfig(pool,POLICY,{enabled:true});await expect(f.api.runJob(pool,POLICY)).rejects.toMatchObject({code:'JANITOR_UNCONFIRMED'});
  const row=(await pool.query('SELECT * FROM janitor_image_intents WHERE settled_at IS NULL ORDER BY created_at DESC LIMIT 1')).rows[0];
  f.state.ids=f.state.ids.filter(n=>image(n)!==row.request.image_id);
  const receipt=await f.engine.receipt(row.request.intent_id);
  const variants=[{actor:'other'},{policy:'other'},{run_id:randomUUID()},{task_id:randomUUID()},{intent_id:randomUUID()},{image_id:image(8)},{digest:'b'.repeat(64)},
    ...['machine_registry_id','daemon_id','docker_root_dir','volume_dev'].map(k=>({identity:{...receipt.identity,[k]:k==='volume_dev'?2:'other'}})),
    {after:{...receipt.after,available_bytes:-1}},{evidence:{image_id:receipt.image_id,absent:false}}];
  for(const variant of variants){
   const controller=createImageRetentionController({pool,engine:{...f.engine,receipt:async()=>({...receipt,...variant})}});
   expect((await controller.reconcile({run_id:row.run_id})).status).toBe('unconfirmed');
   expect((await pool.query('SELECT receipt FROM janitor_image_intents WHERE task_id=$1',[row.task_id])).rows[0].receipt).toBeNull();
   expect((await pool.query('SELECT status FROM tasks WHERE id=$1',[row.task_id])).rows[0].status).toBe('blocked');
  }
  expect((await f.api.reconcileJob(pool,POLICY)).status).toBe('success');expect(f.state.calls).toHaveLength(1);
 }finally{await f.close();}
});
