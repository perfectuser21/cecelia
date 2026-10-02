import {MACHINE_CAPACITY_LOCK_SQL} from '../../orchestrator/attempt-machine-capacity.js';
import {assertLinuxPoolAuthority} from '../../linux-pool/task-authority.js';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {it,expect,beforeAll,afterAll,beforeEach} from 'vitest';
import {DB_DEFAULTS} from '../../db-config.js';
import {createLinuxOnboardingFlow} from '../../linux-pool/onboarding-flow.js';
import {projectLinuxExecution} from '../../linux-pool/onboarding-projection.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
const database=process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname.slice(1):DB_DEFAULTS.database;
if(database!=='cecelia_scratch'&&!(process.env.CI&&database==='cecelia_test'))throw Error('local scratch only');
const schema='linux_onboard_'+randomUUID().replaceAll('-',''),admin=new pg.Client(options),pool=new pg.Pool({...options,application_name:schema,options:`-c search_path=${schema},public`});
let machine,parent;
beforeAll(async()=>{await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);await pool.query(`CREATE TABLE tasks(id UUID PRIMARY KEY,title TEXT,task_type TEXT,executor_kind TEXT,created_by TEXT,error_message TEXT,status TEXT,payload JSONB,result JSONB,parent_task_id UUID,claimed_by TEXT,claimed_at TIMESTAMPTZ,started_at TIMESTAMPTZ,updated_at TIMESTAMPTZ DEFAULT now(),created_at TIMESTAMPTZ DEFAULT now(),completed_at TIMESTAMPTZ);
 CREATE TABLE work_routing_receipts(task_id UUID,source TEXT,source_id TEXT,canonical_task_type TEXT);
 CREATE TABLE task_events(task_id UUID,event_type TEXT,payload JSONB,created_at TIMESTAMPTZ DEFAULT now());
 CREATE TABLE capacity_reservations(id UUID,machine_id TEXT,status TEXT);
 CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,name TEXT,status TEXT,metadata JSONB,updated_at TIMESTAMPTZ DEFAULT now());
 CREATE TABLE execution_nodes(machine_registry_id UUID PRIMARY KEY,current_version_id UUID);
 CREATE TABLE execution_node_versions(id uuid PRIMARY KEY,state text,machine_registry_id uuid);
 CREATE TABLE execution_grants(id uuid PRIMARY KEY,node_version_id uuid,state text,expires_at timestamptz,surface text,provider text,profile_id text);
 CREATE TABLE linux_script_authorizations(id UUID PRIMARY KEY,machine_registry_id UUID,execution_version_id UUID,state TEXT,authorization_expires_at TIMESTAMPTZ,grant_ids jsonb,policy JSONB,evidence_task_id UUID);
 CREATE FUNCTION fixture_grants() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE grant_id uuid:=gen_random_uuid(); BEGIN
 INSERT INTO execution_node_versions(id,state) VALUES(NEW.execution_version_id,'active');
 INSERT INTO execution_grants VALUES(grant_id,NEW.execution_version_id,'active',NEW.authorization_expires_at,'managed_script','script','shell');
 NEW.grant_ids:=jsonb_build_object('shell',grant_id);RETURN NEW;END $$;
 CREATE TRIGGER fixture_grants BEFORE INSERT ON linux_script_authorizations FOR EACH ROW EXECUTE FUNCTION fixture_grants();`);});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{await pool.query('TRUNCATE tasks,system_registry,execution_nodes,linux_script_authorizations,execution_node_versions,execution_grants,task_events,work_routing_receipts,capacity_reservations');parent=randomUUID();machine={id:randomUUID(),name:'new-linux',metadata:{role:'worker',node_health:{os:'linux'},onboarding:{request:{name:'new-linux',address:'100.64.0.2',ssh_user:'root',ssh_port:22,credential_ref:'op://CS/test/private key',host_key_fingerprint:'SHA256:'+'a'.repeat(43),role:'worker',region:'HK'}}}};
 machine.metadata.onboarding.id=machine.id;
 await pool.query("INSERT INTO tasks(id,status,payload) VALUES($1,'completed',$2)",[parent,{node_onboarding:{id:machine.metadata.onboarding.id,request:machine.metadata.onboarding.request}}]);
 await pool.query("INSERT INTO system_registry(id,type,name,status,metadata) VALUES($1,'machine',$2,'active',$3)",[machine.id,machine.name,machine.metadata]);});
const createTask=async (args,internal)=>{expect(assertLinuxPoolAuthority({...args,requested_task_type:args.task_type,task:args},internal)).toBe(true);return {success:true,task:(await args.db.query('INSERT INTO tasks(id,title,task_type,status,payload,parent_task_id,executor_kind,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[randomUUID(),args.title,args.task_type,args.status,args.payload,args.parent_task_id,args.executor_kind,args.created_by])).rows[0]};};
const flow=extra=>createLinuxOnboardingFlow({pool,createTask,revision:'a'.repeat(40),afterTerminal:async()=>{},...extra});
it('并发只登记一个内部接入子任务，nonce/intent服务端生成且observer不登记',async()=>{
 const f=flow({step:async()=>{}});const results=await Promise.all([f.ensure(machine,parent),f.ensure(machine,parent)]);expect(results[0]).toBe(results[1]);
 const rows=(await pool.query("SELECT * FROM tasks WHERE payload ? 'linux_onboarding'")).rows;expect(rows).toHaveLength(1);expect(rows[0].parent_task_id).toBe(parent);expect(rows[0].executor_kind).toBe('linux-pool-controller');
 expect(rows[0].payload.linux_onboarding).toMatchObject({phase:'probe',nonce:expect.stringMatching(/^[a-f0-9]{64}$/),intent_id:expect.any(String)});
 expect(await f.ensure({...machine,metadata:{...machine.metadata,role:'observer'}},parent)).toBe(null);
});
it('metadata把原observer改成worker不能自行登记执行验收，原任务角色才是授权上限',async()=>{
 machine.metadata.onboarding.request.role='observer';
 await pool.query("UPDATE tasks SET payload=jsonb_set(payload,'{node_onboarding,request,role}','\"observer\"') WHERE id=$1",[parent]);
 await pool.query('UPDATE system_registry SET metadata=$2 WHERE id=$1',[machine.id,machine.metadata]);
 let called=false;const f=flow({step:async()=>{called=true;}}),id=await f.ensure(machine,parent);if(id)await f.advance(id);
 expect(id).toBe(null);expect(called).toBe(false);
});
it('已生成的续验阶段收到持久撤销后不会再触SSH，也不能通过ensure重建',async()=>{
 let calls=0;const f=flow({step:async()=>{calls++;}}),id=await f.ensure(machine,parent);
 await pool.query("UPDATE tasks SET payload=jsonb_set(jsonb_set(payload,'{linux_onboarding,phase}','\"renew_wait\"'),'{linux_onboarding,revoked}','true') WHERE id=$1",[id]);
 await pool.query("UPDATE tasks SET payload=jsonb_set(payload,'{node_onboarding,execution_revoked}','true') WHERE id=$1",[parent]);
 expect(await f.advance(id)).toMatchObject({advanced:false});expect(calls).toBe(0);expect(await f.ensure(machine,parent)).toBe(null);
 expect(await f.view(id)).toMatchObject({phase:'revoked',execution:false});
});
it('会话锁覆盖外部副作用；阶段先落库，未知保留同intent，重试不重建任务',async()=>{
 let calls=0,release;const wait=new Promise(r=>{release=r;});
 const f=flow({step:async(_task,_machine,s,save)=>{calls++;await save({...s,phase:'bootstrap'});await wait;throw Error('private-secret');}});
 const id=await f.ensure(machine,parent),first=f.advance(id);while(calls===0)await new Promise(r=>setTimeout(r,5));
 expect(await f.advance(id)).toMatchObject({busy:true});release();await first;
 const row=(await pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];expect(row.payload.linux_onboarding.phase).toBe('bootstrap');expect(JSON.stringify(row)).not.toContain('private-secret');
 await f.retry(id);expect((await pool.query("SELECT id FROM tasks WHERE payload ? 'linux_onboarding'")).rows).toHaveLength(1);expect(calls).toBe(1);
});
it('仅当前未过期active授权才能完成接入任务并写事实证据actor；失效界面回到续验中',async()=>{
 const version=randomUUID(),runtime=randomUUID();const f=flow({step:async(_t,_m,s,save)=>save({...s,phase:'active',runtime_json:JSON.stringify({id:runtime}),active:{execution:true,execution_version_id:version,expires_at:new Date(Date.now()+86400000).toISOString()}})});
 const id=await f.ensure(machine,parent);await pool.query('INSERT INTO execution_nodes VALUES($1,$2)',[machine.id,version]);await pool.query("INSERT INTO linux_script_authorizations(id,machine_registry_id,execution_version_id,state,authorization_expires_at) VALUES($1,$2,$3,'active',now()+interval '24 hours')",[runtime,machine.id,version]);
 await f.advance(id);const task=(await pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];expect(task.status).toBe('completed');expect(task.result).toMatchObject({fact:expect.any(String),actor:'linux-pool-onboarding',evidence:{runtime_id:runtime,execution_version_id:version}});
 expect((await f.view(id)).execution).toBe(true);await pool.query("UPDATE linux_script_authorizations SET authorization_expires_at=now()-interval '1 second'");
 expect(await f.view(id)).toMatchObject({execution:false,phase:'renewal'});
});
it('可编辑设备请求和执行能力不会替代原登记请求或内部身份验收',async()=>{
 let received;const f=flow({step:async(_t,m)=>{received=m;}}),id=await f.ensure(machine,parent);
 await pool.query("UPDATE system_registry SET metadata=jsonb_set(jsonb_set(metadata,'{onboarding,request,address}','\"attacker.invalid\"'),'{node_health,capabilities}','{\"execution\":true}')");
 await f.advance(id);expect(received.metadata.onboarding.request.address).toBe('100.64.0.2');
 expect((await projectLinuxExecution(pool,[machine]))[0].execution.enabled).toBe(false);
});
it('卡片状态绑定当前许可、内部fresh身份及最新接入任务，registry伪造无效',async()=>{
 const version=randomUUID(),runtime=randomUUID();const f=flow({step:async(_t,_m,s,save)=>save({...s,phase:'active',runtime_json:JSON.stringify({id:runtime})})});
 const id=await f.ensure(machine,parent);await pool.query('INSERT INTO execution_nodes VALUES($1,$2)',[machine.id,version]);await pool.query("INSERT INTO linux_script_authorizations(id,machine_registry_id,execution_version_id,state,authorization_expires_at) VALUES($1,$2,$3,'active',now()+interval '24 hours')",[runtime,machine.id,version]);await f.advance(id);
 expect((await projectLinuxExecution(pool,[machine]))[0].execution.enabled).toBe(true);
 await pool.query("UPDATE tasks SET payload=jsonb_set(payload,'{linux_onboarding,identity_ok}','false') WHERE id=$1",[id]);
 expect((await projectLinuxExecution(pool,[machine]))[0].execution.enabled).toBe(false);
});
it('续验不依赖设备metadata中的可编辑任务指针',async()=>{
 const version=randomUUID(),runtime=randomUUID(),boot=randomUUID(),f=flow({checkIdentity:async()=>({worker_boot_id:boot}),step:async(_t,_m,s,save)=>save({...s,phase:'active',
  installation_json:JSON.stringify({receipt:{worker_boot_id:boot}}),runtime_json:JSON.stringify({id:runtime}),active:{execution_version_id:version}})});
 const id=await f.ensure(machine,parent);await pool.query('INSERT INTO execution_nodes VALUES($1,$2)',[machine.id,version]);await pool.query("INSERT INTO linux_script_authorizations(id,machine_registry_id,execution_version_id,state,authorization_expires_at) VALUES($1,$2,$3,'active',now()+interval '30 minutes')",[runtime,machine.id,version]);await f.advance(id);
 await pool.query("UPDATE tasks SET payload=jsonb_set(payload,'{linux_onboarding,identity_checked_at}','\"2000-01-01T00:00:00Z\"') WHERE id=$1",[id]);
 await pool.query("UPDATE system_registry SET metadata=jsonb_set(metadata,'{onboarding,execution_task_id}',$1::jsonb)",[JSON.stringify(randomUUID())]);
 expect(await f.renew()).toEqual(expect.any(String));
});
it.each(['expiry','boot'])('%s自动生成唯一下一棒，保留已完成历史及凭据/安装intent',async kind=>{
 const version=randomUUID(),runtime=randomUUID(),boot=randomUUID();const f=flow({checkIdentity:async()=>({worker_boot_id:kind==='boot'?randomUUID():boot}),step:async(_t,_m,s,save)=>save({...s,phase:'active',
  installation_json:JSON.stringify({receipt:{worker_boot_id:boot}}),runtime_json:JSON.stringify({id:runtime}),active:{execution:true,execution_version_id:version}})});
 const id=await f.ensure(machine,parent);await pool.query('INSERT INTO execution_nodes VALUES($1,$2)',[machine.id,version]);
 await pool.query("INSERT INTO linux_script_authorizations(id,machine_registry_id,execution_version_id,state,authorization_expires_at) VALUES($1,$2,$3,'active',now()+$4::interval)",[runtime,machine.id,version,kind==='expiry'?'30 minutes':'24 hours']);await f.advance(id);
 await pool.query("UPDATE tasks SET payload=jsonb_set(payload,'{linux_onboarding,identity_checked_at}','\"2000-01-01T00:00:00Z\"') WHERE payload ? 'linux_onboarding'");
 await Promise.all([f.renew(),f.renew()]);const rows=(await pool.query("SELECT * FROM tasks WHERE payload ? 'linux_onboarding' ORDER BY created_at")).rows;
 expect(rows).toHaveLength(2);expect(rows[0].status).toBe('completed');expect(rows[1].parent_task_id).toBe(id);
 expect(rows[1].payload.linux_onboarding).toMatchObject({phase:'renew_revoke',previous_runtime_id:runtime,intent_id:rows[0].payload.linux_onboarding.intent_id});
 expect(rows[1].payload.linux_onboarding.nonce).not.toBe(rows[0].payload.linux_onboarding.nonce);
});
it('显式撤销不会被后台续验自动重新授权',async()=>{
 const version=randomUUID(),runtime=randomUUID(),boot=randomUUID(),f=flow({checkIdentity:async()=>({worker_boot_id:boot}),step:async(_t,_m,s,save)=>save({...s,phase:'active',
  installation_json:JSON.stringify({receipt:{worker_boot_id:boot}}),runtime_json:JSON.stringify({id:runtime}),active:{execution:true,execution_version_id:version}})});
 const id=await f.ensure(machine,parent);await pool.query('INSERT INTO execution_nodes VALUES($1,$2)',[machine.id,version]);await pool.query("INSERT INTO linux_script_authorizations(id,machine_registry_id,execution_version_id,state,authorization_expires_at) VALUES($1,$2,$3,'active',now()+interval '24 hours')",[runtime,machine.id,version]);await f.advance(id);
 await pool.query("UPDATE linux_script_authorizations SET state='revoked'");await pool.query("UPDATE tasks SET payload=jsonb_set(payload,'{linux_onboarding,identity_checked_at}','\"2000-01-01T00:00:00Z\"') WHERE payload ? 'linux_onboarding'");
 expect(await f.renew()).toBe(null);expect((await pool.query("SELECT id FROM tasks WHERE payload ? 'linux_onboarding'")).rows).toHaveLength(1);
 expect(await f.view(id)).toMatchObject({execution:false,phase:'revoked'});
});

it.each(['grant_revoke','grant_expiry','version_revoke'])('%s后接入视图与机器卡片都不能假报执行已启用',async kind=>{
 const version=randomUUID(),runtime=randomUUID(),f=flow({step:async(_t,_m,s,save)=>save({...s,phase:'active',runtime_json:JSON.stringify({id:runtime})})});
 const id=await f.ensure(machine,parent);await pool.query('INSERT INTO execution_nodes VALUES($1,$2)',[machine.id,version]);
 await pool.query("INSERT INTO linux_script_authorizations(id,machine_registry_id,execution_version_id,state,authorization_expires_at) VALUES($1,$2,$3,'active',now()+interval '24 hours')",[runtime,machine.id,version]);await f.advance(id);
 if(kind==='version_revoke')await pool.query("UPDATE execution_node_versions SET state='revoked'");
 else if(kind==='grant_revoke')await pool.query("UPDATE execution_grants SET state='revoked'");
 else await pool.query("UPDATE execution_grants SET expires_at=now()-interval '1 second'");
 expect((await f.view(id)).execution).toBe(false);expect((await projectLinuxExecution(pool,[machine]))[0].execution.enabled).toBe(false);
 if(kind!=='grant_expiry'){
  await pool.query("UPDATE tasks SET payload=jsonb_set(payload,'{linux_onboarding,identity_checked_at}','\"2000-01-01T00:00:00Z\"') WHERE id=$1",[id]);
  expect(await f.renew()).toBe(null);expect(await f.view(id)).toMatchObject({phase:'revoked',execution:false});
 }
});

async function failedController(){
 const f=flow({step:async()=>{}}),id=await f.ensure(machine,parent),at=new Date().toISOString();
 const report={type:'node_onboarding_receipt',id:machine.id,name:machine.name,mode:'enroll',verified:true,service:{active:true,enabled:true},health:{schema_version:1,node_id:machine.id,agent_version:'1',observed_at:at,boot_id:randomUUID(),sequence:2,hostname:machine.name,os:'linux',capabilities:{collector:true,janitor:true,execution:false},janitor:{mode:'observe',policy:'owned-cache-only'},resources:{memory_total_bytes:8e9,memory_available_bytes:4e9,cpu_load_1m:0,cpu_cores:4,disk_free_bytes:10e9,disk_total_bytes:40e9}}};
 await pool.query("UPDATE tasks SET completed_at=$2,result=$3,payload=jsonb_set(jsonb_set(payload,'{node_onboarding,mode}','\"enroll\"'),'{node_onboarding,reconciled}','true') WHERE id=$1",[parent,at,{script:{exit_code:0,stdout:JSON.stringify(report)}}]);
 await pool.query("UPDATE tasks SET status='failed',executor_kind=NULL,claimed_by=NULL,error_message=$2,payload=jsonb_set(payload,'{linux_onboarding,phase}','\"script_prepare\"') WHERE id=$1",[id,'S2锚点执法：task缺少 payload.anchor.{journey_id,gp_id,step_id}，拒绝点火']);
 const old=(await pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];
 await pool.query("INSERT INTO work_routing_receipts VALUES($1,'scheduler',$2,'audit')",[id,'linux-pool-onboarding:'+old.payload.linux_onboarding.nonce]);
 await pool.query("INSERT INTO task_events(task_id,event_type,payload) VALUES($1,'watchdog_safe_requeue',$2)",[id,{reason:'no_spawn_evidence',headed_manual:false,evidence:{active_process:false,process_log:false,dispatch_receipt:false}}]);
 return {f,id,old};
}
it('原官方retry保留误收failed历史，以同机新私有controller棒从probe接续且幂等',async()=>{
 const {f,id,old}=await failedController();const next=await f.retry(id);
 expect(next.task_id).not.toBe(id);expect(next.phase).toBe('probe');
 const row=(await pool.query('SELECT * FROM tasks WHERE id=$1',[next.task_id])).rows[0];
 expect(row).toMatchObject({status:'in_progress',executor_kind:'linux-pool-controller',claimed_by:'linux-pool-onboarding',parent_task_id:id});
 expect(row.payload.linux_onboarding.nonce).not.toBe(old.payload.linux_onboarding.nonce);
 expect(row.payload.linux_onboarding.intent_id).not.toBe(old.payload.linux_onboarding.intent_id);
 expect((await pool.query('SELECT status,error_message FROM tasks WHERE id=$1',[id])).rows[0]).toMatchObject({status:'failed',error_message:old.error_message});
 expect((await f.retry(id)).task_id).toBe(next.task_id);
});
it.each(['event','route','source','revoked','occupied','other_error','foreign_claim','active_grant','unretired_runtime'])('恢复拒绝%s，不能把公共payload变成controller授权',async kind=>{
 const {f,id}=await failedController();
 if(kind==='event')await pool.query('DELETE FROM task_events WHERE task_id=$1',[id]);
 if(kind==='route')await pool.query('DELETE FROM work_routing_receipts WHERE task_id=$1',[id]);
 if(kind==='source')await pool.query('UPDATE tasks SET result=NULL WHERE id=$1',[parent]);
 if(kind==='revoked')await pool.query("UPDATE tasks SET payload=jsonb_set(payload,'{node_onboarding,execution_revoked}','true') WHERE id=$1",[parent]);
 if(kind==='occupied')await pool.query("INSERT INTO capacity_reservations VALUES($1,$2,'running')",[randomUUID(),machine.name]);
 if(kind==='other_error')await pool.query("UPDATE tasks SET error_message='unrelated_failure' WHERE id=$1",[id]);
 if(kind==='foreign_claim')await pool.query("UPDATE tasks SET claimed_by='other-session' WHERE id=$1",[id]);
 if(kind==='active_grant'){const v=randomUUID();await pool.query("INSERT INTO execution_node_versions VALUES($1,'active',$2)",[v,machine.id]);await pool.query("INSERT INTO execution_grants VALUES($1,$2,'active',now()+interval '1 hour','managed_script','script','shell')",[randomUUID(),v]);}
 if(kind==='unretired_runtime')await pool.query("INSERT INTO linux_script_authorizations(id,machine_registry_id,execution_version_id,state,authorization_expires_at) VALUES($1,$2,$3,'prepared',now()+interval '1 hour')",[randomUUID(),machine.id,randomUUID()]);
 await expect(f.retry(id)).rejects.toThrow();expect((await pool.query("SELECT id FROM tasks WHERE payload ? 'linux_onboarding'")).rows).toHaveLength(1);
});

it('并发原retry只登记一棒，新父子claim不冒领，source指针原子更新',async()=>{
 const {f,id}=await failedController();const results=await Promise.all([f.retry(id),f.retry(id)]);
 expect(results[0].task_id).toBe(results[1].task_id);
 expect((await pool.query("SELECT id FROM tasks WHERE payload ? 'linux_onboarding'")).rows).toHaveLength(2);
 expect((await pool.query('SELECT payload FROM tasks WHERE id=$1',[parent])).rows[0].payload.node_onboarding.execution_task_id).toBe(results[0].task_id);
});

it('retry等待capacity期间不抢registry行锁，避免与runtime的capacity→registry锁序互锁',async()=>{
 const {f,id}=await failedController(),other=await pool.connect();let pending,readError;
 try{
  await other.query('BEGIN');await other.query(MACHINE_CAPACITY_LOCK_SQL,[machine.name]);
  pending=f.retry(id);let waiting=false;
  for(let n=0;n<100;n++){
   waiting=(await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory' AND query LIKE '%harness_attempt_machine%'",[schema])).rowCount>0;
   if(waiting)break;await new Promise(r=>setTimeout(r,5));
  }
  expect(waiting).toBe(true);
  try{await other.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE NOWAIT',[id]);await other.query('SELECT id FROM system_registry WHERE id=$1 FOR SHARE NOWAIT',[machine.id]);}catch(e){readError=e.code;}
 }finally{await other.query('ROLLBACK');other.release();await pending;}
 expect(readError).toBeUndefined();
});
