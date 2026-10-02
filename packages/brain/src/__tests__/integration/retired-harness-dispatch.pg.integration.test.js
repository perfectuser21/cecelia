import pg from 'pg';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import {DB_DEFAULTS} from '../../db-config.js';
import {initializeRetirementSchema} from '../helpers/retired-harness-pg-fixture.js';

const fixture=vi.hoisted(()=>({mode:'allow',spawns:[],kills:[],network:[]}));
const schemas=[0,1].map(()=>`retire_smoke_${process.pid}_${randomUUID().replaceAll('-','')}`);
if(DB_DEFAULTS.database!==(process.env.CI==='true'?'cecelia_test':'cecelia_scratch'))throw Error('退役fixture本机仅scratch/CI仅cecelia_test');
const admin=new pg.Client(DB_DEFAULTS);
const pools=schemas.map(schema=>new pg.Pool({...DB_DEFAULTS,max:4,options:`-c search_path=${schema} -c statement_timeout=1500`}));
const pool=pools[0];
// 实际SQL透传同一私有Pool；生产Router、路由器、selector与terminal均不mock。
vi.mock('../../db.js',()=>({default:{query:(...args)=>pool.query(...args),connect:()=>pool.connect()}}));
vi.mock('../../drain.js',()=>({isDraining:()=>fixture.mode==='drain',getDrainStartedAt:()=>null}));
vi.mock('../../quota-cooling.js',()=>({isGlobalQuotaCooling:()=>false,getQuotaCoolingState:()=>({active:false})}));
vi.mock('../../quota-guard.js',()=>({checkQuotaGuard:async()=>({allow:true})}));
vi.mock('../../account-usage.js',()=>({proactiveTokenCheck:async()=>{}}));
vi.mock('../../alertness-actions.js',()=>({getMitigationState:()=>({drain_mode_requested:false,p2_paused:false})}));
// 明示test-only policy输入，绝不代表已验证的生产物理容量。
vi.mock('../../slot-allocator.js',()=>({
 calculateSlotBudget:async()=>({dispatchAllowed:fixture.mode!=='full'&&fixture.mode!=='unknown',resourceAdmissionBlocked:fixture.mode==='unknown',taskPool:{budget:4,used:fixture.mode==='full'?4:0,available:fixture.mode==='full'?0:4},user:{mode:'absent'},codex:{available:false}}),
 harnessSlotCheck:async()=>{throw Error('退役fixture不应进入harness admission');},
 shouldBypassBackpressure:()=>false,
}));
vi.mock('../../executor.js',async importOriginal=>{
 const actual=await importOriginal();
 const forbidden=name=>(...args)=>{fixture[name==='kill'?'kills':'spawns'].push(args);throw Error(`退役fixture禁止${name}`);};
 return {...actual,getBillingPause:()=>({active:fixture.mode==='billing',resetTime:null}),triggerCeceliaRun:forbidden('spawn'),killProcessTwoStage:forbidden('kill')};
});
vi.mock('node:child_process',async importOriginal=>{
 const actual=await importOriginal(),deny=(...args)=>{fixture.spawns.push(args);throw Error('退役fixture禁止外部进程');};
 const blocked={spawn:deny,spawnSync:deny,exec:deny,execSync:deny,execFile:deny,execFileSync:deny,fork:deny};
 return {...actual,...blocked,default:{...actual.default,...blocked}};
});
let server,origin,dispatchNextTask,fetchSpy;
beforeAll(async()=>{
 await admin.connect();
 for(let i=0;i<schemas.length;i++){
  await admin.query(`CREATE SCHEMA ${schemas[i]}`);await initializeRetirementSchema(pools[i]);
  const row=(await pools[i].query('SELECT current_database() AS db,current_schema() AS schema,current_setting(\'search_path\') AS path')).rows[0];
  expect(row).toEqual({db:DB_DEFAULTS.database,schema:schemas[i],path:schemas[i]});
 }
 const {default:router}=await import('../../routes/task-tasks.js');
 ({dispatchNextTask}=await import('../../dispatcher.js'));
 const app=express();app.use(express.json());app.use('/api/brain/tasks',router);
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 origin=`http://127.0.0.1:${server.address().port}`;
 const nativeFetch=globalThis.fetch;
 fetchSpy=vi.spyOn(globalThis,'fetch').mockImplementation((url,...args)=>{
  if(new URL(String(url)).origin!==origin){fixture.network.push(String(url));throw Error('退役fixture禁止外部HTTP');}
  return nativeFetch(url,...args);
 });
});
afterAll(async()=>{
 fetchSpy?.mockRestore();if(server)await new Promise(resolve=>server.close(resolve));
 for(const p of pools)await p.end();
 for(const schema of schemas)await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
 await admin.end();
});
beforeEach(async()=>{
 fixture.mode='allow';fixture.spawns.length=0;fixture.kills.length=0;fixture.network.length=0;
 // 仅重置本test创建的两随机schema，不清任何共享库/其它任务。
 for(const db of pools)await db.query('TRUNCATE tasks,work_routing_receipts,cecelia_events,dispatch_events,working_memory');
});
afterEach(()=>{expect(fixture.spawns).toEqual([]);expect(fixture.kills).toEqual([]);expect(fixture.network).toEqual([]);});
async function createRetired(payload={}){
 const response=await fetch(`${origin}/api/brain/tasks`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:`[smoke] isolated-retirement-${randomUUID()}`,description:'retired harness planner fixture',task_type:'harness_planner',priority:'P2',trigger_source:'manual',payload})});
 const body=await response.json();expect(response.status,JSON.stringify(body)).toBe(201);
 expect(body.task_type).toBe('harness_planner');expect(body.status).toBe('queued');
 const receipt=(await pool.query('SELECT task_id,canonical_task_type FROM work_routing_receipts WHERE id=$1',[body.payload.routing_receipt_id])).rows[0];
 expect(receipt).toEqual({task_id:body.id,canonical_task_type:'harness_planner'});
 return body.id;
}
async function readTask(id){
 const response=await fetch(`${origin}/api/brain/tasks/${id}`);expect(response.status).toBe(200);return response.json();
}
async function neighbors(){
 const ids=[];
 for(const db of pools)for(const status of ['paused','in_progress']){
  const id=randomUUID();await db.query("INSERT INTO tasks(id,title,task_type,status,priority,payload,claimed_by) VALUES($1,'普通邻居','data',$2,'P2',$3,'fixture-neighbor')",[id,status,{sentinel:randomUUID()}]);ids.push({db,id,before:(await db.query('SELECT to_jsonb(t) AS row FROM tasks t WHERE id=$1',[id])).rows[0].row});
 }
 return async()=>{for(const {db,id,before} of ids)expect((await db.query('SELECT to_jsonb(t) AS row FROM tasks t WHERE id=$1',[id])).rows[0].row).toEqual(before);};
}
it('实际migration ledger独立、当前库/schema与无public fallback已核',async()=>{
 expect((await pool.query('SELECT version FROM schema_version ORDER BY version')).rows.map(r=>r.version)).toEqual(['413','426','427','465']);
});
it('真实API→dispatchNextTask→finalizeTask持久退役；另一schema的全池污染不影响自己',async()=>{
 const preserve=await neighbors();
 for(let i=0;i<24;i++)await pools[1].query("INSERT INTO tasks(title,task_type,status,priority) VALUES('另schema占用','data','in_progress','P2')");
 const id=await createRetired(),r=await dispatchNextTask([]),row=await readTask(id);
 expect(r.actions).toContainEqual({action:'retire-task',task_id:id,task_type:'harness_planner'});
 expect(r.reason).toBe('no_dispatchable_task');expect(row.status).toBe('failed');expect(row.error_message).toMatch(/retired.*subsumed/);
 expect(row.payload.failure_class).toBe('pipeline_terminal_failure');expect(row.completed_at).toBeTruthy();expect(row.claimed_by).toBeNull();
 const actual=(await pool.query('SELECT status,error_message,payload,completed_at FROM tasks WHERE id=$1',[id])).rows[0];
 expect(actual.status).toBe('failed');expect(actual.payload.failure_class).toBe('pipeline_terminal_failure');expect(actual.completed_at).toBeInstanceOf(Date);await preserve();
});
for(const [mode,reason] of [['full','pool_c_full'],['unknown','resource_unavailable'],['drain','draining'],['billing','billing_pause']])it(`真实${mode}拒绝保持queued与普通邻居，绝不为smoke升预算`,async()=>{
 const preserve=await neighbors(),id=await createRetired(),before=await readTask(id);fixture.mode=mode;
 const r=await dispatchNextTask([]);expect(r.reason).toBe(reason);expect(r.actions).toEqual([]);expect(await readTask(id)).toEqual(before);await preserve();
});
it('真实SQL拒绝终态时不能以dispatch正常返回冒成功：任务仍queued、无退役action',async()=>{
 // 真实建单即标manual，SQL失败后selector仍真实运行但不会进入候选业务执行。
 const id=await createRetired({headed_manual:true});
 await pool.query(`CREATE FUNCTION reject_retirement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${id}'::uuid AND NEW.status='failed' THEN RAISE EXCEPTION 'fixture_retire_rejected'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER reject_retirement BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION reject_retirement();`);
 try{const r=await dispatchNextTask([]);expect(r.actions.some(a=>a.task_id===id)).toBe(false);expect((await readTask(id)).status).toBe('queued');expect((await readTask(id)).completed_at).toBeNull();}
 finally{await pool.query('DROP TRIGGER reject_retirement ON tasks; DROP FUNCTION reject_retirement()');}
});
