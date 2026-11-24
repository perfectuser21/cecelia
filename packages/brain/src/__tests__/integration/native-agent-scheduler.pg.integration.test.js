/** 正式Tick→真实选单/认领/原生Worker→真实PG终态；仅资源观测与外部运输为隔离边界。 */
import {afterAll,beforeAll,expect,test,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createIntakeTestDatabase} from '../fixtures/task-intake-db.js';
import {createNativeAgentHostFixture} from '../helpers/native-agent-host-fixture.js';
const state=vi.hoisted(()=>({pool:null,host:null,capacityBlocked:false}));
vi.mock('../../db.js',()=>({default:{query:(...args)=>state.pool.query(...args),connect:(...args)=>state.pool.connect(...args)}}));
vi.mock('../../alertness/index.js',async original=>({...await original(),canDispatch:()=>true}));
vi.mock('../../slot-allocator.js',async original=>({...await original(),calculateSlotBudget:async()=>({
 dispatchAllowed:false,resourceAdmissionBlocked:state.capacityBlocked,
 taskPool:{budget:0,used:0,available:0},user:{mode:'absent'},codex:{available:false,running:0,max:0},budgetState:{state:'abundant'},
})}));
vi.mock('../../lib/native-agent-transport.js',async original=>({...await original(),
 resolveNativeAgentHost:async()=>state.host.host,
 nativeAgentTransport:(host,request)=>state.host.transport(host,request),
}));
import {runScheduler} from '../../tick-scheduler.js';
import {reapNativeAgentRuns} from '../../native-agent-executor.js';
let fixture;
const read=async id=>(await state.pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];
beforeAll(async()=>{
 fixture=await createIntakeTestDatabase();state.pool=fixture.pool;state.host=createNativeAgentHostFixture();
 // 真实选单/所有者/运行表共享正式迁移形状，所有写入均留在本人schema。
 const tables=(await state.pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`)).rows;
 for(const {tablename} of tables){
  if(!/^[a-z0-9_]+$/.test(tablename))throw Error('unexpected test table identity');
  await state.pool.query(`CREATE TABLE IF NOT EXISTS ${fixture.schema}.${tablename} (LIKE public.${tablename} INCLUDING ALL)`);
 }
 for(const [key,value] of Object.entries(state.host.env))vi.stubEnv(key,String(value));
 vi.stubGlobal('fetch',async()=>{throw Error('scheduler fixture forbids external HTTP');});
});
afterAll(async()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();state.host?.close();await fixture?.close();});

test('没有活跃KR且通用AI池满时，正式Tick只执行Notion原生任务并留下真实进程与PG回执',async()=>{
 const id=randomUUID(),ordinary=randomUUID(),body='请处理本次已授权的完整交办，不修改外部系统。 '+id;
 await state.pool.query(`INSERT INTO tasks(id,title,description,task_type,status,priority,tenant_id,executor_kind,payload)
 VALUES($1,$2,$3,'qiumi_task','queued','P2','fixture-native','external-worker',$4)`,
 [id,'无KR原生交办 '+id,body,{native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:['fixture-page']},qiumi_source:{body}}]);
 await state.pool.query(`INSERT INTO tasks(id,title,description,task_type,status,priority,payload)
 VALUES($1,'不可从原生入口派发的普通任务','此任务没有KR，不允许借用原生任务通道执行。','research','queued','P0','{}')`,[ordinary]);
 expect((await state.pool.query("SELECT id FROM key_results WHERE status IN ('active','in_progress','decomposing')")).rows).toEqual([]);
 const dispatched=await runScheduler();
 expect(dispatched).toMatchObject({dispatched:true,task_id:id});
 for(let i=0;i<100&&(await read(id)).status==='in_progress';i++){
  await reapNativeAgentRuns(state.pool);await new Promise(resolve=>setTimeout(resolve,30));
 }
 const done=await read(id);expect(done.status).toBe('completed_no_pr');
 expect(done.result.receipt.text).toContain('实际fixture执行结果');
 expect(state.host.launches().filter(x=>x.text.includes(body))).toHaveLength(1);
 expect(await read(ordinary)).toMatchObject({status:'queued',claimed_by:null});
 const runs=(await state.pool.query('SELECT * FROM task_runs WHERE task_id=$1',[id])).rows;
 expect(runs).toHaveLength(1);expect(runs[0].ended_at).not.toBeNull();
 expect(runs[0].context.source).toBe('native-agent');
});
