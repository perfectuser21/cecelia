import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {beforeAll,afterAll,beforeEach,it,expect} from 'vitest';
import {DB_DEFAULTS} from '../../../db-config.js';
import {directory} from '../../../execution-directory/directory.js';
import {importLegacyPolicy,revokeGrant} from '../../../execution-directory/store.js';
import {LEGACY_BINDINGS} from '../../../execution-directory/legacy-policy.js';
import {createAppServerStore} from '../../../app-server/store.js';
import {createAuthorizationStore} from '../../../app-server/authorization-store.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
if(!/_(scratch|test)$/.test(process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname:DB_DEFAULTS.database))throw Error('scratch/test database required');
const schema=`app_server_${process.pid}_${randomUUID().replaceAll('-','')}`;
const admin=new pg.Client(options),pool=new pg.Pool({...options,max:8,options:`-c search_path=${schema},public`});
const env={FLEET_WORKER_US_MAC_M4_URL:'http://mmv:5231',FLEET_WORKER_XIAN_MAC_M1_URL:'http://m1:5231',FLEET_WORKER_XIAN_MAC_M4_URL:'http://m4:5231'};
const config=()=>({homeId:`chat-${randomUUID()}`,homeKey:randomUUID().replaceAll('-','').repeat(2),provider:'codex',account:'team1',repo:'perfectuser21/cecelia',profile:'chat-'+randomUUID(),configDigest:'a'.repeat(64)});
const snapshot=machine=>({verified:true,machine,captured_at:Date.now(),expires_at:Date.now()+60_000,capacity:{ok:true,physical_base_slots:8,effective_base_slots:8}});
const boots=new Map();
const caps=(machine,home)=>{if(!boots.has(machine))boots.set(machine,randomUUID());return {machine_id:machine,worker_id:machine,worker_boot_id:boots.get(machine),profiles:{[home.profile]:home.configDigest}};};
const createTask=async({db})=>({success:true,task:(await db.query("INSERT INTO tasks(id,status,task_type,executor_kind) VALUES($1,'in_progress','app_server_run','app-server-controller') RETURNING *",[randomUUID()])).rows[0]});
const store=()=>createAppServerStore({pool,createTask,afterTask:async()=>{}});
// 存储层历史测试只装配已验收权威记录；完整Worker签名链由canary-service真HTTP回归覆盖。
async function authorizeFixture(home,machine,capabilities=caps(machine,home),db=pool){
 const existing=(await db.query("SELECT id FROM app_server_authorizations WHERE home->>'homeKey'=$1 AND state='active'",[home.homeKey])).rows[0];if(existing)return;
 const node=(await db.query('SELECT * FROM execution_nodes WHERE canonical_id=$1',[machine])).rows[0];
 const auth=await createAuthorizationStore({pool:db,homes:{[home.homeId]:home},client:{probeCapabilities:async()=>capabilities},...(db===pool?{createTask}:{})}).prepare({home_id:home.homeId,machine_registry_id:node.machine_registry_id,expected_version_id:node.current_version_id});
 const c=await db.connect();try{await c.query('BEGIN');
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('app-server-home:'||$1,0))",[home.homeKey]);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('harness_attempt_machine:'||$1,0))",[machine]);
  if((await c.query('SELECT state FROM app_server_authorizations WHERE id=$1',[auth.id])).rows[0].state==='active'){await c.query('COMMIT');return;}
  await c.query("UPDATE tasks SET status='completed' WHERE id=$1",[auth.evidence_task_id]);
  await c.query("UPDATE app_server_authorizations SET state='accepted',accepted_at=now(),evidence=$2 WHERE id=$1",[auth.id,{nonce:auth.nonce,worker_boot_id:auth.worker_boot_id,config_digest:home.configDigest,cleanup_confirmed:true}]);
  await c.query("UPDATE execution_grants SET state='active' WHERE id=$1",[auth.grant_id]);
  await c.query("UPDATE app_server_authorizations SET state='active',activated_at=now() WHERE id=$1",[auth.id]);await c.query('COMMIT');
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 await directory.refresh({pool:db});
}
const reserve=async(home,requestKey=randomUUID(),machineId='xian-mac-m1')=>{await authorizeFixture(home,machineId);return store().reserve({home,requestKey,machineId,capacitySnapshot:snapshot(machineId),capabilities:caps(machineId,home)});};
beforeAll(async()=>{await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,name TEXT,status TEXT,metadata JSONB DEFAULT '{}');CREATE TABLE tasks(id UUID PRIMARY KEY,status TEXT,result JSONB,updated_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,claimed_by TEXT,claimed_at TIMESTAMPTZ,payload JSONB DEFAULT '{}',task_type TEXT CONSTRAINT tasks_task_type_check CHECK(task_type IN ('dev','janitor')),executor_kind TEXT CONSTRAINT tasks_executor_kind_check CHECK(executor_kind IN ('headed-session','preview-janitor')));CREATE TABLE initiative_runs(id UUID PRIMARY KEY,phase TEXT DEFAULT 'planning',map_recovery_contract_id UUID,orchestrator_version TEXT DEFAULT 'v2');CREATE TABLE map_recovery_consumptions(contract_id UUID,attempt_id UUID);CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ);`);
 for(const [,id,name]of LEGACY_BINDINGS)await pool.query("INSERT INTO system_registry(id,type,name,status) VALUES($1,'machine',$2,'active')",[id,name]);
 for(const name of ['357_harness_provider_attempts','362_kernel_attempt_telemetry_reconcile','363_kernel_fleet_execution_receipts','364_kernel_local_container_naming','425_harness_attempt_cleanup_outbox','501_capacity_reservations','503_execution_directory','504_app_server_generations','506_app_server_streams','508_app_server_authorizations','509_app_server_canary_attempts'])await pool.query(readFileSync(new URL(`../../../../migrations/${name}.sql`,import.meta.url),'utf8'));
 await importLegacyPolicy({pool,env});

});
beforeEach(async()=>{await directory.refresh({pool});});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});
it('同HOME并发只生成一代；不同幂等请求不能抢占；重建store保留亲和',async()=>{
 const h=config(),key=randomUUID();const [a,b]=await Promise.all([reserve(h,key),reserve(h,key)]);
 expect(a.reservation.id).toBe(b.reservation.id);expect(a.reservation.owner_kind).toBe('app_server');
 expect(a.reservation.execution_version_id).toBeTruthy();expect(a.reservation.owner_key).not.toBe(`openclaw-${h.homeKey}`);
 await expect(reserve(h,randomUUID())).rejects.toThrow('appserver_home_busy');
 await expect(reserve(h,key,'xian-mac-m4')).rejects.toThrow('appserver_home_affinity');
 expect((await store().get(a.reservation.id)).home_key).toBe(h.homeKey);
});
it('整机预约阻止另一HOME；task终态和清理lease过期均不释放',async()=>{
 const h=config(),a=await reserve(h,randomUUID(),'xian-mac-m4');
 await pool.query("UPDATE tasks SET status='completed' WHERE id=$1",[a.reservation.task_id]);
 expect((await reserve(config(),randomUUID(),'xian-mac-m4')).outcome).toBe('wait');
 const pending=await store().requestCancel(a.reservation.id);
 await pool.query("UPDATE capacity_reservations SET cleanup_claim_expires_at=now()-interval '1 hour' WHERE id=$1",[a.reservation.id]);
 expect((await store().get(a.reservation.id)).status).not.toBe('released');
 await expect(store().confirmCleanup(a.reservation.id,{authenticated:true,receipt:{...pending,status:'cleaned',absent:true,tombstoned:true}})).rejects.toThrow('appserver_cleanup_receipt_mismatch');
});
it('撤销不释放既有HOME；新start最终授权拒绝且未知不跨机',async()=>{
 const h=config(),a=await reserve(h,randomUUID(),'us-mac-m4');
 await revokeGrant({pool,grantId:a.reservation.execution_grant_id});
 let calls=0;await expect(store().withOperation(a.reservation.id,'start',()=>{calls++;})).rejects.toThrow('execution_grant_denied');
 await store().withOperation(a.reservation.id,'inspect',(_r,url)=>{expect(url).toBe('http://mmv:5231');calls++;});
 expect(calls).toBe(1);expect((await store().get(a.reservation.id)).status).not.toBe('released');
});

it('真实Brain controller→签名HTTP→Worker journal闭环；丢start回执重启追认，不以task终态释放',async()=>{
 const [{createRequire},{default:fs},{default:os},{default:path},{createAppServerController},{createAppServerClient},{workerIdentity}]=await Promise.all([
  import('node:module'),import('node:fs'),import('node:os'),import('node:path'),import('../../../app-server/controller.js'),import('../../../app-server/client.js'),import('../../../app-server/identity.js')]);
 const require=createRequire(import.meta.url),{createAppServerRunner}=require('../../../../scripts/fleet-worker/app-server-runner.cjs'),{createFleetWorkerServer}=require('../../../../scripts/fleet-worker/fleet-worker.cjs'),{profileDigest}=require('../../../../scripts/fleet-worker/app-server-profile.cjs');
 const st=store();
 // 前例的测试预约以精确fixture回执结清；生产路径的回执由下方真实HTTP签名验证。
 for(const row of await st.listOutstanding()){
  const pending=await st.requestCancel(row.id);
  await st.confirmCleanup(row.id,{authenticated:true,receipt:{...workerIdentity(pending),container_id:pending.container_id,challenge:pending.cleanup_challenge,status:'cleaned',absent:true,tombstoned:true}});
 }
 const home=config(),profile={image:`sha256:${'f'.repeat(64)}`,cpus:1,memoryBytes:1024**3,pidsLimit:128,user:'1000:1000',tmpBytes:1024**2,network:'none',homeKey:home.homeKey,workspaceKey:'e'.repeat(64)};
 home.configDigest=profileDigest(profile);
 const stateRoot=fs.mkdtempSync(path.join(os.tmpdir(),'appserver-pg-http-')),bootId=randomUUID(),token='test-controller-token-with-32-characters';
 const {EventEmitter}=await import('node:events'),{PassThrough}=await import('node:stream');
 let creates=0,lost=true,lostCleanup=false,raw;const containers=new Map();
 const runner=createAppServerRunner({stateRoot,machineId:'xian-mac-m1',workerId:'xian-mac-m1',bootId,profiles:{[home.profile]:profile},assertLocalResources:async()=>{},docker:{
  async create({name,identity}){const id=(++creates).toString(16).padStart(64,'0');containers.set(id,{id,name,status:'created',labels:Object.fromEntries(Object.entries(identity).map(([k,v])=>[`cecelia.appserver.${k}`,String(v)]))});return id;},async inspect(id){return containers.get(id)??null;},async start(id){containers.get(id).status='running';},async remove(id){containers.delete(id);},
  attach(){raw=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),kill(){this.emit('close');}});return raw;}}});
 const server=createFleetWorkerServer({attemptToken:token,appServerRunner:runner});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const fetchFn=async(url,options)=>{expect(new URL(url).hostname).toBe('m1');const response=await fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`,options);
  if(url.endsWith('/start')&&lost){lost=false;await response.text();throw Error('simulated_start_receipt_lost');}
  if(url.endsWith('/cancel')&&lostCleanup){lostCleanup=false;await response.text();throw Error('simulated_cleanup_receipt_lost');}return response;};
 const client=createAppServerClient({pool,store:st,env:{KERNEL_FLEET_BRIDGE_TOKEN:token},fetchFn});
 const make=()=>createAppServerController({pool,store:st,homes:{[home.homeId]:home},client,collectSnapshot:async machine=>snapshot(machine)});
 const request={home_id:home.homeId,request_key:randomUUID()};
 await authorizeFixture(home,'xian-mac-m1',{machine_id:'xian-mac-m1',worker_id:'xian-mac-m1',worker_boot_id:bootId,profiles:{[home.profile]:home.configDigest}});
 try{
  await expect(make().ensure({...request,machine_id:'us-mac-m4',limits:{cpus:64}})).rejects.toThrow('appserver_request_invalid');
  await expect(make().ensure(request)).rejects.toThrow('appserver_worker_unavailable');expect(creates).toBe(1);
  const row=(await st.listOutstanding())[0];expect(row.machine_id).toBe('xian-mac-m1');
  await pool.query("UPDATE tasks SET status='completed' WHERE id=$1",[row.task_id]);
  expect((await make().reconcile())[0].status).toBe('running');expect(creates).toBe(1);
  expect((await make().ensure(request)).reservation_id).toBe(row.id);expect(creates).toBe(1);
  const ticket=await client.prepareStream(row.id);
  await runner.markRpcStarted({...workerIdentity(row),stream_id:ticket.stream_id});
  const reconnect={...request,request_key:randomUUID()};
  await expect(make().ensure(reconnect)).rejects.toThrow('appserver_home_busy');expect(containers.size).toBe(1);
  raw.kill();await new Promise(r=>setTimeout(r,10));lostCleanup=true;
  await expect(make().ensure(reconnect)).rejects.toThrow('appserver_worker_unavailable');
  expect(containers.size).toBe(0);expect((await st.get(row.id)).status).toBe('cleanup_pending');expect(creates).toBe(1);
  const next=await make().ensure(reconnect);expect(next.generation).toBe(2);expect(next.machine_id).toBe('xian-mac-m1');
  expect((await st.get(row.id)).status).toBe('released');expect(creates).toBe(2);expect(containers.size).toBe(1);
  expect((await make().ensure(request)).status).toBe('released');expect(creates).toBe(2);
  await revokeGrant({pool,grantId:row.execution_grant_id});
  await expect(make().ensure(reconnect)).rejects.toThrow('execution_grant_denied');
  expect((await make().cancel(next.reservation_id)).status).toBe('released');expect(containers.size).toBe(0);
  const settled=await st.get(row.id);expect(settled.confirmed_receipt).toMatchObject({status:'cleaned',home_key:home.homeKey,owner_key:row.owner_key});
  expect((await st.home(home.homeId)).machine_id).toBe('xian-mac-m1');
  await expect(reserve(home,randomUUID(),'xian-mac-m4')).rejects.toThrow('appserver_home_affinity');
 }finally{await new Promise(r=>server.close(r));fs.rmSync(stateRoot,{recursive:true,force:true});}
});
it('同机最终start与撤销串行，取消落库后迟到start拒绝，独立generation仅在精确清理后生成',async()=>{
 await directory.refresh({pool});
 const h=config(),a=await reserve(h,randomUUID(),'xian-mac-m4');const st=store();
 let release,entered;const hold=new Promise(r=>release=r),ready=new Promise(r=>entered=r);let revoked=false;
 const start=st.withOperation(a.reservation.id,'start',async()=>{entered();await hold;});await ready;
 const revoke=revokeGrant({pool,grantId:a.reservation.execution_grant_id}).then(()=>{revoked=true;});
 await new Promise(r=>setTimeout(r,20));expect(revoked).toBe(false);release();await start;await revoke;
 await expect(st.withOperation(a.reservation.id,'start',()=>{})).rejects.toThrow('execution_grant_denied');
 const pending=await st.requestCancel(a.reservation.id);
 await expect(st.withOperation(a.reservation.id,'start',()=>{})).rejects.toThrow('appserver_launch_tombstoned');
 const {workerIdentity}=await import('../../../app-server/identity.js');
 const receipt={...workerIdentity(pending),container_id:null,challenge:pending.cleanup_challenge,status:'cleaned',absent:true,tombstoned:true};
 for(const changed of [{authenticated:false,receipt},{authenticated:true,receipt:{...receipt,owner_key:'openclaw-'+ '0'.repeat(64)}},{authenticated:true,receipt:{...receipt,home_key:'0'.repeat(64)}},{authenticated:true,receipt:{...receipt,challenge:randomUUID()}}])await expect(st.confirmCleanup(pending.id,changed)).rejects.toThrow('appserver_cleanup_receipt_mismatch');
 await st.confirmCleanup(pending.id,{authenticated:true,receipt});
 const task=(await pool.query('SELECT status,result FROM tasks WHERE id=$1',[pending.task_id])).rows[0];expect(task.status).toBe('completed');expect(task.result.app_server_receipt).toEqual(receipt);
 await pool.query("UPDATE app_server_authorizations SET state='revoked' WHERE grant_id=$1",[a.reservation.execution_grant_id]);await authorizeFixture(h,'xian-mac-m4');
 const next=await reserve(h,randomUUID(),'xian-mac-m4');expect(next.reservation.launch_generation).toBe(2);expect(next.reservation.owner_key).not.toBe(a.reservation.owner_key);
 await expect(pool.query("UPDATE app_server_homes SET machine_id='us-mac-m4' WHERE home_key=$1",[h.homeKey])).rejects.toThrow('appserver_home_affinity_immutable');
});
it('Harness与app-server共用同机预算；脚本reaper不能接管app-server预约',async()=>{
 const {createAttemptStore}=await import('../../../orchestrator/attempt-store.js');
 const {createScriptReservationStore}=await import('../../../orchestrator/script-reservation-store.js');
 const runId=randomUUID();await pool.query('INSERT INTO initiative_runs(id) VALUES($1)',[runId]);
 const input={id:randomUUID(),runId,hop:1,phase:'planning',role:'reporter',provider:'codex',accountId:'team1',machineId:'xian-mac-m4',callbackSecretHash:'a'.repeat(64),capacitySnapshot:snapshot('xian-mac-m4'),bundle:{inputs:{workspace_spec:{repo:'perfectuser21/cecelia'}}}};
 await expect(createAttemptStore(pool,{executionDirectory:true}).createAttempt(input)).rejects.toThrow('machine_capacity_contended');
 const app=(await store().listOutstanding())[0];const script=createScriptReservationStore(pool);
 expect(await script.listOutstanding()).toEqual([]);expect(await script.claimCleanup(app.id,'script-reaper',1000)).toBeNull();
 const other={...input,id:randomUUID(),machineId:'us-mac-m4',capacitySnapshot:snapshot('us-mac-m4')};await createAttemptStore(pool,{executionDirectory:true}).createAttempt(other);
 expect((await reserve(config(),randomUUID(),'us-mac-m4')).outcome).toBe('wait');
});
it('默认建账factory经真实createTask/work-router写tasks与不可变路由收据',async()=>{
 const {createIntakeTestDatabase}=await import('../../../__tests__/fixtures/task-intake-db.js');const fixture=await createIntakeTestDatabase(),db=fixture.pool;
 try{
  await db.query("CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,name TEXT,status TEXT,metadata JSONB DEFAULT '{}');CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ)");
  for(const [,id,name]of LEGACY_BINDINGS)await db.query("INSERT INTO system_registry(id,type,name,status) VALUES($1,'machine',$2,'active')",[id,name]);
  for(const name of ['357_harness_provider_attempts','362_kernel_attempt_telemetry_reconcile','363_kernel_fleet_execution_receipts','364_kernel_local_container_naming','425_harness_attempt_cleanup_outbox','501_capacity_reservations','503_execution_directory','504_app_server_generations','506_app_server_streams','508_app_server_authorizations','509_app_server_canary_attempts'])await db.query(readFileSync(new URL(`../../../../migrations/${name}.sql`,import.meta.url),'utf8'));
  await importLegacyPolicy({pool:db,env});await directory.refresh({pool:db});
  const h=config();await authorizeFixture(h,'xian-mac-m1',caps('xian-mac-m1',h),db);const result=await createAppServerStore({pool:db}).reserve({home:h,requestKey:randomUUID(),machineId:'xian-mac-m1',capacitySnapshot:snapshot('xian-mac-m1'),capabilities:caps('xian-mac-m1',h)});
  const row=(await db.query('SELECT t.*,r.work_kind,r.canonical_task_type FROM tasks t JOIN work_routing_receipts r ON r.task_id=t.id WHERE t.id=$1',[result.reservation.task_id])).rows[0];
  expect(row).toMatchObject({task_type:'app_server_run',canonical_task_type:'app_server_run',executor_kind:'app-server-controller',work_kind:'operations',status:'in_progress'});
  expect(row.payload.home_key).toBe(h.homeKey);
  expect((await db.query("SELECT 1 FROM schema_version WHERE version='504'")).rowCount).toBe(1);
 }finally{await fixture.close();await directory.refresh({pool});}
});
it('流意图跨重启保持同ID；真实attach与撤销同锁，未知/过期不新建第二条许可',async()=>{
 const st=store(),a=await reserve(config(),randomUUID(),'xian-mac-m1'),id=a.reservation.id;
 expect(st.reserveStream).toBeTypeOf('function');const stream=await st.reserveStream(id);expect((await store().reserveStream(id)).id).toBe(stream.id);
 let entered,release;const ready=new Promise(r=>entered=r),hold=new Promise(r=>release=r);let revoked=false;
 const attached=st.withOperation(id,'prepare-stream',async row=>{expect(row.stream.id).toBe(stream.id);entered();await hold;});await ready;
 const revocation=revokeGrant({pool,grantId:a.reservation.execution_grant_id}).then(()=>revoked=true);
 await new Promise(r=>setTimeout(r,20));expect(revoked).toBe(false);release();await attached;await revocation;
 let invoked=false;await expect(st.withOperation(id,'prepare-stream',()=>invoked=true)).rejects.toThrow('execution_grant_denied');expect(invoked).toBe(false);
 await expect(pool.query('UPDATE app_server_streams SET id=$2 WHERE id=$1',[stream.id,randomUUID()])).rejects.toThrow('appserver_stream_identity_immutable');
 expect((await st.get(id)).status).not.toBe('released');
});
