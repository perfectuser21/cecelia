import {beforeAll,afterAll,expect,test,vi} from 'vitest';
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
 for(const name of ['task_runs','workflows','task_events','device_locks','task_leases','working_memory','ops_agents','phone_registry'])await state.pool.query(`CREATE TABLE ${fixture.schema}.${name} (LIKE public.${name} INCLUDING ALL)`);
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
