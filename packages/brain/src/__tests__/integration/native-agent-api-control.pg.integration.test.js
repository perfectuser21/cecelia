import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {createIntakeTestDatabase} from '../fixtures/task-intake-db.js';
const state=vi.hoisted(()=>({pool:null}));
vi.mock('../../db.js',()=>({default:{query:(...args)=>state.pool.query(...args),connect:(...args)=>state.pool.connect(...args)}}));
vi.mock('../../event-bus.js',async original=>({...await original(),emit:vi.fn(async()=>{})}));
vi.mock('../../thalamus.js',async original=>({...await original(),processEvent:vi.fn(async()=>({}))}));
vi.mock('../../decision-executor.js',async original=>({...await original(),executeDecision:vi.fn(async()=>({}))}));
import taskRouter from '../../routes/task-tasks.js';
import executionRouter from '../../routes/execution.js';
import {registerTaskStatusRoutes} from '../../routes/tasks-status.js';
import {processExecutionCallback} from '../../callback-processor.js';
import {triggerNativeAgent,requestNativeAgentCancellation} from '../../native-agent-executor.js';
import {createRunReconciliationRouter} from '../../routes/run-reconciliation.js';
import {blockTask,unblockTask,updateTaskStatus} from '../../task-updater.js';
let fixture,app,previousToken;
beforeEach(async()=>{
 fixture=await createIntakeTestDatabase();state.pool=fixture.pool;
 for(const table of ['task_runs','task_events','callback_queue','decision_log','device_locks','task_leases','pending_actions'])
  await state.pool.query(`CREATE TABLE ${fixture.schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
 previousToken=process.env.CECELIA_INTERNAL_TOKEN;process.env.CECELIA_INTERNAL_TOKEN='native-control-isolated-token';
 app=express();app.use(express.json());
 const engine=express.Router();registerTaskStatusRoutes(engine);app.use('/engine',engine);
 app.use('/tasks',taskRouter);app.use('/api',executionRouter);
});
afterEach(async()=>{
 if(previousToken===undefined)delete process.env.CECELIA_INTERNAL_TOKEN;else process.env.CECELIA_INTERNAL_TOKEN=previousToken;
 await fixture?.close();fixture=null;
});
const read=async id=>(await state.pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];
async function seed({source='native-agent',record=true,status='in_progress',eraseBinding=false}={}){
 const id=randomUUID(),runId=randomUUID(),nonce=randomUUID(),digest='a'.repeat(64);
 const host={machine_id:'fixture-host',bundle_sha256:digest};
 const binding={protocol:'native-agent-binding/v1',host,resources:{device_serial:'fixture-device'},device_locks:[],
  request:{task_id:id,run_id:runId,input_digest:digest,request_nonce:nonce},cancel_requested:false};
 await state.pool.query(`INSERT INTO tasks(id,title,task_type,status,executor_kind,payload,result,blocked_at)
  VALUES($1,$2,'qiumi_task',$3::varchar,'external-worker',$4,$5,CASE WHEN $3::varchar='blocked' THEN NOW() END)`,[id,'native API '+id,status,{run_id:runId},{native_agent:eraseBinding?null:binding}]);
 if(record)await state.pool.query(`INSERT INTO task_runs(task_id,run_id,context) VALUES($1,$2,$3)`,
  [id,runId,{source,native_agent:{...binding.request,host,resource_bound:true}}]);
 return {id,runId,binding};
}

test('DELETE真实原生运行不能直接写cancelled，只登记原run取消意图',async()=>{
 const h=await seed();const response=await request(app).delete('/tasks/'+h.id);
 expect([202,409]).toContain(response.status);
 const task=await read(h.id);expect(task.status).toBe('in_progress');
 expect(task.result.native_agent.request.run_id).toBe(h.runId);
 if(response.status===202)expect(task.result.native_agent.cancel_requested).toBe(true);
 expect((await state.pool.query('SELECT ended_at FROM task_runs WHERE run_id=$1',[h.runId])).rows[0].ended_at).toBeNull();
});
for(const path of ['/engine/tasks/','/tasks/'])for(const status of ['failed','completed_no_pr'])
 test(`${path}普通PATCH不能替原生控制器结算${status}`,async()=>{
  const h=await seed();const response=await request(app).patch(path+h.id).send({status});
  expect(response.status).toBe(409);expect((await read(h.id)).status).toBe('in_progress');
 });
for(const value of [null,{}, {request:{run_id:randomUUID()}}])for(const path of ['/engine/tasks/','/tasks/'])
 test(`${path}禁止覆盖/清空server-only原生绑定${JSON.stringify(value)}`,async()=>{
  const h=await seed();const response=await request(app).patch(path+h.id).send({result:{native_agent:value}});
  expect(response.status).toBe(409);expect((await read(h.id)).result.native_agent).toEqual(h.binding);
 });
test('真实TaskRun保护不依赖已损坏的Task JSON标签',async()=>{
 const h=await seed({eraseBinding:true});
 expect((await request(app).patch('/engine/tasks/'+h.id).send({status:'failed'})).status).toBe(409);
 expect([202,409]).toContain((await request(app).delete('/tasks/'+h.id)).status);
 expect((await read(h.id)).status).toBe('in_progress');
});
test('资源owner_decision待复核也不能被通用PATCH写终态或重新queued',async()=>{
 const h=await seed({status:'blocked'});
 await state.pool.query("UPDATE tasks SET blocked_reason='owner_decision' WHERE id=$1",[h.id]);
 for(const status of ['failed','queued'])expect((await request(app).patch('/tasks/'+h.id).send({status})).status).toBe(409);
 expect((await read(h.id)).status).toBe('blocked');
});
for(const source of ['absent','openclaw-agent'])test(`伪nativeJSON无真实native TaskRun(${source})不阻断普通任务`,async()=>{
 const h=await seed({record:source!=='absent',source});
 expect((await request(app).patch('/engine/tasks/'+h.id).send({status:'failed'})).status).toBe(200);
 expect((await read(h.id)).status).toBe('failed');
});
test('普通任务也不能通过API写入server-only settlement来伪造资源释放证明',async()=>{
 const h=await seed({record:false});
 const r=await request(app).patch('/engine/tasks/'+h.id).send({result:{native_agent_resource_settlement:{basis:'operator-cleanup-review'}}});
 expect(r.status).toBe(409);expect((await read(h.id)).result.native_agent_resource_settlement).toBeUndefined();
});
test('通用HTTP callback与队列callback不能终结实际native run',async()=>{
 const h=await seed();
 const response=await request(app).post('/api/execution-callback').set('Authorization','Bearer native-control-isolated-token')
  .send({task_id:h.id,status:'AI Failed',result:{error:'generic callback'}});
 expect(response.status).toBe(409);
 await expect(processExecutionCallback({task_id:h.id,status:'AI Failed',result:{error:'queued callback'}},state.pool)).rejects.toThrow('native_agent_control_owned');
 expect((await read(h.id)).status).toBe('in_progress');
 expect((await state.pool.query('SELECT ended_at FROM task_runs WHERE run_id=$1',[h.runId])).rows[0].ended_at).toBeNull();
});
test('队列callback独立路径也不能终结实际native run',async()=>{
 const h=await seed();
 await expect(processExecutionCallback({task_id:h.id,status:'AI Failed',result:{error:'queued callback'}},state.pool)).rejects.toThrow('native_agent_control_owned');
 expect((await read(h.id)).status).toBe('in_progress');
});
test('Notion hold与通用updater不伪暂停/解除真实原生运行',async()=>{
 const h=await seed();
 expect(await blockTask(h.id,{reason:'owner_hold',detail:'主理人要求暂停'})).toMatchObject({success:false,error:'native_agent_control_owned'});
 expect((await read(h.id)).status).toBe('in_progress');
 expect(await updateTaskStatus(h.id,'failed')).toMatchObject({success:false,error:'native_agent_control_owned'});
 await state.pool.query("UPDATE tasks SET status='blocked',blocked_at=NOW(),blocked_reason='owner_decision' WHERE id=$1",[h.id]);
 expect(await unblockTask(h.id)).toMatchObject({success:false,error:'native_agent_control_owned'});
 expect((await read(h.id)).status).toBe('blocked');
});
for(const path of ['/engine/tasks/','/tasks/','delete'])test(`真实reservation持锁提交后${path}须fresh核控制权`,async()=>{
 const h=await seed({record:false});const owner=await state.pool.connect();let operation;
 try{
  await owner.query('BEGIN');await owner.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[h.id]);
  await owner.query('INSERT INTO task_runs(task_id,run_id,context) VALUES($1,$2,$3)',[h.id,h.runId,{source:'native-agent',native_agent:{...h.binding.request,host:h.binding.host,resource_bound:true}}]);
  await owner.query('UPDATE tasks SET result=result WHERE id=$1',[h.id]);
  let ended=false;
  operation=(path==='delete'?request(app).delete('/tasks/'+h.id):request(app).patch(path+h.id).send({status:'failed'})).then(r=>{ended=true;return r;});
  for(let i=0;i<100&&!ended;i++){
   const waiting=(await state.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>$1",[owner.processID])).rows;
   if(waiting.length)break;await new Promise(resolve=>setTimeout(resolve,2));
  }
  await owner.query('COMMIT');const r=await operation;
  expect([202,409]).toContain(r.status);expect((await read(h.id)).status).toBe('in_progress');
 }finally{await owner.query('ROLLBACK');if(operation)await operation.catch(()=>{});owner.release();}
});
test('被拒通用写入后原run仍能inspect、登记取消并进入原复核入口',async()=>{
 const h=await seed();
 await request(app).patch('/engine/tasks/'+h.id).send({result:{native_agent:null}});
 const transport=vi.fn(async()=>{throw Error('native_agent_transport_unconfirmed');});
 await triggerNativeAgent(await read(h.id),{pool:state.pool,transport});
 expect(transport).toHaveBeenCalledWith(h.binding.host,expect.objectContaining({action:'inspect',run_id:h.runId}));
 expect(await requestNativeAgentCancellation(state.pool,h.id)).toEqual({matched:true});
 expect((await read(h.id)).result.native_agent.request.run_id).toBe(h.runId);
 await state.pool.query("UPDATE tasks SET status='blocked',blocked_at=NOW(),blocked_reason='owner_decision',blocked_detail=$2 WHERE id=$1",[h.id,{run_id:h.runId}]);
 const reviewTransport=vi.fn(async()=>{throw Error('native_agent_transport_unconfirmed');});
 const review=express();review.use('/runs',createRunReconciliationRouter({pool:state.pool,nativeTransport:reviewTransport}));
 const r=await request(review).post('/runs/'+h.runId+'/native-resource-reconciliation').set('Authorization','Bearer native-control-isolated-token')
  .send({task_id:h.id,pending_action_id:randomUUID(),cleanup_confirmed:true,effects_reviewed:true,evidence:['independent readback'],expected_devices:[]});
 expect(r.status).toBe(503);expect(r.body.error).toBe('native_agent_cleanup_stop_unknown');
 expect(reviewTransport).toHaveBeenCalledWith(h.binding.host,expect.objectContaining({action:'inspect',run_id:h.runId}));
 expect((await read(h.id)).status).toBe('blocked');
});
