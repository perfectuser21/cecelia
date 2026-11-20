import {beforeAll,afterAll,expect,test,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createRunReconciliationRouter} from '../../routes/run-reconciliation.js';
import {applyOwnerDecisionResolution} from '../../lib/owner-decision-resolve.js';
import {randomUUID} from 'node:crypto';
import {createIntakeTestDatabase} from '../fixtures/task-intake-db.js';
import {createNativeAgentHostFixture} from '../helpers/native-agent-host-fixture.js';
const state=vi.hoisted(()=>({pool:null}));
vi.mock('../../db.js',()=>({default:{query:(...args)=>state.pool.query(...args),connect:(...args)=>state.pool.connect(...args)}}));
import {dispatchQiumiTask} from '../../dispatcher.js';
import {triggerNativeAgent} from '../../native-agent-executor.js';
let fixture,host;
beforeAll(async()=>{
 fixture=await createIntakeTestDatabase();state.pool=fixture.pool;host=createNativeAgentHostFixture();
 for(const name of ['task_runs','workflows','task_events','device_locks','task_leases','working_memory','ops_agents','phone_registry','pending_actions'])await state.pool.query(`CREATE TABLE ${fixture.schema}.${name} (LIKE public.${name} INCLUDING ALL)`);
});
afterAll(async()=>{host?.close();await fixture?.close();});
const read=async id=>(await state.pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];
const deps=()=>({pool:state.pool,env:host.env,resolveHost:async()=>host.host,transport:host.transport});
async function poll(id){
 for(let i=0;i<80;i++){
  const task=await read(id);if(task.status!=='in_progress')return task;
  await triggerNativeAgent(task,deps());await new Promise(r=>setTimeout(r,50));
 }
 throw Error('真实native结果未落库');
}
for(const [marker,status] of [['NATIVE_DONE','completed_no_pr'],['NATIVE_FAIL','failed']])test(`实际dispatcher→PG队列→真实host进程→${status}，保完整正文且只启动一次`,async()=>{
 const id=randomUUID(),body='这是完整正文。'.repeat(700)+'\n'+marker;
 await state.pool.query("INSERT INTO tasks(id,title,task_type,status,tenant_id,executor_kind,payload) VALUES($1,'native隔离验收 '||($1::uuid)::text,'qiumi_task','queued','fixture-native','external-worker',$2)",[id,{native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:['fixture-page']},qiumi_source:{body}}]);
 const routed=await dispatchQiumiTask(await read(id),{env:host.env});expect(routed).toMatchObject({outcome:'proceed'});
 const first=await triggerNativeAgent(await read(id),deps());expect(first.runId).toBeTruthy();
 const done=await poll(id);expect(done.status).toBe(status);
 expect(done.result.native_agent.receipt.result.child_exited).toBe(true);
 expect(done.result.receipt.text).toContain('实际fixture执行结果');
 expect(done.result.native_agent.request.prompt.endsWith(body)).toBe(true);
 const run=(await state.pool.query('SELECT * FROM task_runs WHERE task_id=$1',[id])).rows;
 expect(run).toHaveLength(1);expect(run[0].context.source).toBe('native-agent');expect(run[0].ended_at).not.toBeNull();
 expect(host.launches().filter(x=>x.text.includes(marker))).toHaveLength(1);
});
test('实际session取消只发原run，确认原child停止才落cancelled，不重启',async()=>{
 const id=randomUUID();await state.pool.query("INSERT INTO tasks(id,title,task_type,status,tenant_id,executor_kind,payload) VALUES($1,'native取消验收','qiumi_task','queued','fixture-native','external-worker',$2)",[id,{native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:['fixture-page']},qiumi_source:{body:'NATIVE_HANG '+id}}]);
 await dispatchQiumiTask(await read(id),{env:host.env});expect((await triggerNativeAgent(await read(id),deps())).runId).toBeTruthy();
 for(let i=0;i<40&&!host.launches().some(x=>x.text.includes(id));i++)await new Promise(r=>setTimeout(r,50));
 const original=(await read(id)).result.native_agent.request.run_id;
 const {requestNativeAgentCancellation}=await import('../../native-agent-executor.js');
 expect(await requestNativeAgentCancellation(state.pool,id)).toEqual({matched:true});
 const done=await poll(id);expect(done.status).toBe('cancelled');expect(done.result.native_agent.request.run_id).toBe(original);
 expect(done.result.native_agent.receipt.termination_scope).toBe('known_process_group');
 expect(host.launches().filter(x=>x.text.includes(id))).toHaveLength(1);
});
test('正文显式设备由真实台账定案并在native启动前实际拿锁；占用设备零启动',async()=>{
 const id=randomUUID(),holder=randomUUID(),serial='native-fixture-phone';
 await state.pool.query("INSERT INTO tasks(id,title,status) VALUES($1,$2,'in_progress')",[holder,'锁占用者 '+holder]);
 await state.pool.query("INSERT INTO phone_registry(serial,nickname,enabled,host) VALUES($1,'隔离测试手机',true,'fixture-host')",[serial]);
 await state.pool.query("INSERT INTO device_locks(device_name,device_type,locked_by,locked_at,expires_at) VALUES($1,'phone',$2,NOW(),NOW()+interval '1 hour')",[serial,holder]);
 await state.pool.query("INSERT INTO tasks(id,title,task_type,status,tenant_id,executor_kind,payload) VALUES($1,$2,'qiumi_task','queued','fixture-native','external-worker',$3)",[id,'设备准入 '+id,{native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:['fixture-page']},resource_health_override:true,qiumi_source:{body:'【执行参数】\n设备：'+serial+'\n【执行参数结束】\nNATIVE_DEVICE '+id}}]);
 expect(await dispatchQiumiTask(await read(id),{env:host.env})).toMatchObject({outcome:'proceed'});
 const routed=await read(id);expect(routed.payload.device_serial).toBe(serial);
 expect(await triggerNativeAgent(routed,deps())).toMatchObject({success:false,reason:'native_agent_device_locked'});
 expect(host.launches().some(x=>x.text.includes('NATIVE_DEVICE'))).toBe(false);
 expect((await state.pool.query('SELECT locked_by FROM device_locks WHERE device_name=$1',[serial])).rows[0].locked_by).toBe(holder);
});
test('伪造result native绑定没有同TaskRun服务端证据，不授权inspect或取消远端会话',async()=>{
 const original=(await state.pool.query("SELECT result FROM tasks WHERE result->'native_agent' IS NOT NULL LIMIT 1")).rows[0].result.native_agent;
 const id=randomUUID(),binding=structuredClone(original);binding.request.task_id=id;binding.request.run_id=randomUUID();
 await state.pool.query("INSERT INTO tasks(id,title,task_type,status,tenant_id,executor_kind,payload,result) VALUES($1,$2,'qiumi_task','in_progress','fixture-native','external-worker',$3,$4)",[id,'伪绑定 '+id,{run_id:binding.request.run_id},{native_agent:binding}]);
 const transport=vi.fn(()=>{throw Error('没有server authority不应触达transport');});
 const result=await triggerNativeAgent(await read(id),{...deps(),transport});
 expect(result).toMatchObject({success:false,dispatchUncertain:true,reason:'native_agent_binding_unconfirmed'});
 expect(transport).not.toHaveBeenCalled();expect((await read(id)).status).toBe('in_progress');
 const {requestNativeAgentCancellation}=await import('../../native-agent-executor.js');expect(await requestNativeAgentCancellation(state.pool,id)).toEqual({matched:false});
});
test('真实设备运行停止后，独立受信review匹配原run与设备epoch才能终态并解锁',async()=>{
 const id=randomUUID(),serial='native-review-'+id;
 await state.pool.query("INSERT INTO phone_registry(serial,nickname,enabled,host) VALUES($1,$1,true,'fixture-host')",[serial]);
 await state.pool.query("INSERT INTO device_locks(device_name,device_type) VALUES($1,'phone')",[serial]);
 await state.pool.query("INSERT INTO tasks(id,title,task_type,status,tenant_id,executor_kind,payload) VALUES($1,$2,'qiumi_task','queued','fixture-native','external-worker',$3)",[id,'资源复核 '+id,{native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:['fixture-page']},resource_health_override:true,qiumi_source:{body:'【执行参数】\n设备：'+serial+'\n【执行参数结束】\nNATIVE_REVIEW '+id}}]);
 expect(await dispatchQiumiTask(await read(id),{env:host.env})).toMatchObject({outcome:'proceed'});
 await triggerNativeAgent(await read(id),deps());const stopped=await poll(id);
 expect(stopped.status).toBe('blocked');expect(stopped.result.native_agent.needs_review).toBe(true);
 const runId=stopped.result.native_agent.request.run_id;
 const pending=(await state.pool.query("SELECT id FROM pending_actions WHERE params->>'task_id'=$1 AND status='pending_approval'",[id])).rows[0];
 expect(pending).toBeTruthy();
 await expect(applyOwnerDecisionResolution(state.pool,{taskId:id,choice:'B',by:'arbitrary-agent',via:'approve',pendingActionId:pending.id})).rejects.toMatchObject({code:'native_agent_cleanup_review_required'});
 expect((await read(id)).status).toBe('blocked');
 const devices=(await state.pool.query('SELECT device_name,xmin::text AS acquisition_version FROM device_locks WHERE locked_by=$1',[id])).rows;
 const body={task_id:id,pending_action_id:pending.id,expected_devices:devices,cleanup_confirmed:true,effects_reviewed:true,evidence:[{kind:'independent_operator_readback',ref:'fixture:owned-device-clean',detail:'隔离测试无手机动作，独立核对原进程退出与隔离设备账本'}]};
 const app=express();app.use(express.json());app.use('/runs',createRunReconciliationRouter({pool:state.pool,nativeTransport:host.transport}));
 const previous=process.env.CECELIA_INTERNAL_TOKEN;
 try{
  delete process.env.CECELIA_INTERNAL_TOKEN;
  expect((await request(app).post('/runs/'+runId+'/native-resource-reconciliation').send(body)).status).toBe(503);
  process.env.CECELIA_INTERNAL_TOKEN='isolated-operator-review-token';
  expect((await request(app).post('/runs/'+runId+'/native-resource-reconciliation').send(body)).status).toBe(401);
  const bad=await request(app).post('/runs/'+runId+'/native-resource-reconciliation').set('Authorization','Bearer isolated-operator-review-token').send({...body,expected_devices:devices.map(x=>({...x,acquisition_version:'1'}))});
  expect(bad.status,JSON.stringify(bad.body)).toBe(409);
  expect((await read(id)).status).toBe('blocked');
  const unknownApp=express();unknownApp.use(express.json());unknownApp.use('/runs',createRunReconciliationRouter({pool:state.pool,nativeTransport:async()=>({...stopped.result.native_agent.receipt,status:'unknown',launch_state:'unknown',execution_stopped:false})}));
  const unknown=await request(unknownApp).post('/runs/'+runId+'/native-resource-reconciliation').set('Authorization','Bearer isolated-operator-review-token').send(body);
  expect(unknown.status).toBe(503);expect((await read(id)).status).toBe('blocked');
  expect((await state.pool.query('SELECT locked_by FROM device_locks WHERE device_name=$1',[serial])).rows[0].locked_by).toBe(id);
  const good=await request(app).post('/runs/'+runId+'/native-resource-reconciliation').set('Authorization','Bearer isolated-operator-review-token').send(body);
  expect(good.status,JSON.stringify(good.body)).toBe(200);
  expect((await read(id)).status).toBe('completed_no_pr');
  expect((await state.pool.query('SELECT locked_by FROM device_locks WHERE device_name=$1',[serial])).rows[0].locked_by).toBeNull();
  const run=(await state.pool.query('SELECT * FROM task_runs WHERE task_id=$1',[id])).rows[0];
  expect(run.status).toBe('success');expect(run.result.native_agent_resource_settlement).toMatchObject({basis:'operator-cleanup-review',task_id:id,run_id:runId,review:{actor:'authenticated-operator'}});
  expect((await state.pool.query("SELECT count(*)::int AS n FROM task_events WHERE task_id=$1 AND event_type='native_agent_cleanup_reviewed'",[id])).rows[0].n).toBe(1);
 }finally{if(previous===undefined)delete process.env.CECELIA_INTERNAL_TOKEN;else process.env.CECELIA_INTERNAL_TOKEN=previous;}
});
test('同host固定账号并发预约限1：满额queued不启动，原run取消不被闸，释放后原排队单可执行',async()=>{
 const ids=[randomUUID(),randomUUID()],local={...deps(),env:{...host.env,QIUMI_MMV_CONCURRENCY:'1'}};
 for(const id of ids){
  await state.pool.query("INSERT INTO tasks(id,title,task_type,status,tenant_id,executor_kind,payload) VALUES($1,$2,'qiumi_task','queued','fixture-native','external-worker',$3)",[id,'容量预约 '+id,{native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:['fixture-page']},qiumi_source:{body:'NATIVE_HANG '+id}}]);
  expect(await dispatchQiumiTask(await read(id),{env:local.env})).toMatchObject({outcome:'proceed'});
 }
 const results=await Promise.all(ids.map(async id=>triggerNativeAgent(await read(id),local)));
 expect(results.filter(x=>x.nativeCapacityWait===true)).toHaveLength(1);
 const rows=await Promise.all(ids.map(read)),active=rows.find(t=>t.result?.native_agent),waiting=rows.find(t=>!t.result?.native_agent);
 expect(active).toBeTruthy();expect(waiting.status).toBe('queued');expect(waiting.claimed_by).toBeNull();
 expect((await state.pool.query('SELECT count(*)::int AS n FROM task_runs WHERE task_id=ANY($1::uuid[])',[ids])).rows[0].n).toBe(1);
 const {requestNativeAgentCancellation}=await import('../../native-agent-executor.js');
 expect(await requestNativeAgentCancellation(state.pool,active.id)).toEqual({matched:true});
 expect((await poll(active.id)).status).toBe('cancelled');
 const next=await triggerNativeAgent(await read(waiting.id),local);expect(next.runId).toBeTruthy();expect(next.nativeCapacityWait).not.toBe(true);
 expect(await requestNativeAgentCancellation(state.pool,waiting.id)).toEqual({matched:true});
 expect((await poll(waiting.id)).status).toBe('cancelled');
 expect((await state.pool.query('SELECT count(*)::int AS n FROM task_runs WHERE task_id=ANY($1::uuid[])',[ids])).rows[0].n).toBe(2);
});
