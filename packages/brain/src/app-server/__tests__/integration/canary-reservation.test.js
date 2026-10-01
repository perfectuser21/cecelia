import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {DB_DEFAULTS} from '../../../db-config.js';
import {directory} from '../../../execution-directory/directory.js';
import {importLegacyPolicy} from '../../../execution-directory/store.js';
import {LEGACY_BINDINGS} from '../../../execution-directory/legacy-policy.js';
import {createAppServerStore} from '../../../app-server/store.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
if(!/_(scratch|test)$/.test(process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname:DB_DEFAULTS.database))throw Error('scratch/test database required');
const schema=`app_canary_${process.pid}_${randomUUID().replaceAll('-','')}`;
const admin=new pg.Client(options),pool=new pg.Pool({...options,max:8,options:`-c search_path=${schema},public`});
const env={FLEET_WORKER_US_MAC_M4_URL:'http://mmv:5231',FLEET_WORKER_XIAN_MAC_M1_URL:'http://m1:5231',FLEET_WORKER_XIAN_MAC_M4_URL:'http://m4:5231'};
const config=()=>({homeId:`chat-${randomUUID()}`,homeKey:randomUUID().replaceAll('-','').repeat(2),provider:'codex',account:'team1',repo:'perfectuser21/cecelia',profile:'chat',configDigest:'a'.repeat(64)});
const snapshot=machine=>({verified:true,machine,captured_at:Date.now(),expires_at:Date.now()+60_000,capacity:{ok:true,physical_base_slots:8,effective_base_slots:8}});
const caps=machine=>({machine_id:machine,worker_id:machine,worker_boot_id:randomUUID(),profiles:{chat:'a'.repeat(64)}});
const createTask=async({db})=>({success:true,task:(await db.query("INSERT INTO tasks(id,status,task_type,executor_kind) VALUES($1,'in_progress','app_server_run','app-server-controller') RETURNING *",[randomUUID()])).rows[0]});
const store=()=>createAppServerStore({pool,createTask,afterTask:async()=>{}});
beforeAll(async()=>{await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,name TEXT,status TEXT,metadata JSONB DEFAULT '{}');CREATE TABLE tasks(id UUID PRIMARY KEY,status TEXT,result JSONB,updated_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,claimed_by TEXT,claimed_at TIMESTAMPTZ,payload JSONB DEFAULT '{}',task_type TEXT CONSTRAINT tasks_task_type_check CHECK(task_type IN ('dev','janitor')),executor_kind TEXT CONSTRAINT tasks_executor_kind_check CHECK(executor_kind IN ('headed-session','preview-janitor')));CREATE TABLE initiative_runs(id UUID PRIMARY KEY,phase TEXT DEFAULT 'planning',map_recovery_contract_id UUID,orchestrator_version TEXT DEFAULT 'v2');CREATE TABLE map_recovery_consumptions(contract_id UUID,attempt_id UUID);CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ);`);
 for(const [,id,name]of LEGACY_BINDINGS)await pool.query("INSERT INTO system_registry(id,type,name,status) VALUES($1,'machine',$2,'active')",[id,name]);
 for(const name of ['357_harness_provider_attempts','362_kernel_attempt_telemetry_reconcile','363_kernel_fleet_execution_receipts','364_kernel_local_container_naming','425_harness_attempt_cleanup_outbox','501_capacity_reservations','503_execution_directory','504_app_server_generations','506_app_server_streams','508_app_server_authorizations','509_app_server_canary_attempts'])await pool.query(readFileSync(new URL(`../../../../migrations/${name}.sql`,import.meta.url),'utf8'));
 await importLegacyPolicy({pool,env});
});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});
async function prepare(){
 const {createAuthorizationStore}=await import('../../authorization-store.js');
 const home={...config(),profile:`chat-${randomUUID()}`},capabilities=caps('xian-mac-m1');capabilities.profiles={[home.profile]:home.configDigest};
 const node=(await pool.query("SELECT * FROM execution_nodes WHERE canonical_id='xian-mac-m1'")).rows[0];
 const authStore=createAuthorizationStore({pool,homes:{[home.homeId]:home},client:{probeCapabilities:async()=>capabilities},createTask});
 const auth=await authStore.prepare({home_id:home.homeId,machine_registry_id:node.machine_registry_id,expected_version_id:node.current_version_id});
 return {auth,authStore,home,capabilities,capacitySnapshot:snapshot('xian-mac-m1')};
}
it('pending仅可创建两代受限验收预约；整机占位、并发幂等及普通聊天隔离',async()=>{
 const {auth,home,capabilities,capacitySnapshot}=await prepare(),st=store();
 await directory.refresh({pool});
 expect(st.reserveCanary).toBeTypeOf('function');
 await expect(st.reserve({home,requestKey:randomUUID(),machineId:'xian-mac-m1',capabilities,capacitySnapshot})).rejects.toThrow('execution_grant_denied');
 const input={authorizationId:auth.id,sequence:1,capabilities,capacitySnapshot};
 const [a,b]=await Promise.all([st.reserveCanary(input),st.reserveCanary(input)]);
 expect(a.reservation.id).toBe(b.reservation.id);expect(a.reservation.policy_version).toBe('app-server-canary-v1');
 const first=a.reservation;
 const other=await prepare();expect((await st.reserveCanary({capabilities:other.capabilities,capacitySnapshot:other.capacitySnapshot,authorizationId:other.auth.id,sequence:1})).outcome).toBe('wait');
 await expect(st.reserveCanary({...input,sequence:2})).rejects.toThrow('appserver_home_busy');
 let called=0;await st.withOperation(first.id,'start',row=>{expect(row.canary_authorization.id).toBe(auth.id);called++;});expect(called).toBe(1);
 const stream=await st.reserveStream(first.id);expect(stream.id).toBeTruthy();
 const {workerIdentity}=await import('../../identity.js'),pending=await st.requestCancel(first.id);
 await st.confirmCleanup(first.id,{authenticated:true,receipt:{...workerIdentity(pending),container_id:null,challenge:pending.cleanup_challenge,status:'cleaned',absent:true,tombstoned:true}});
 const second=await st.reserveCanary({...input,sequence:2});expect(second.reservation.launch_generation).toBe(2);
 expect((await st.reserveCanary({...input,sequence:2})).reservation.id).toBe(second.reservation.id);
 await expect(st.reserveCanary({...input,sequence:3})).rejects.toThrow('appserver_canary_request_invalid');
 await expect(pool.query('UPDATE app_server_canary_attempts SET sequence_no=1 WHERE reservation_id=$1',[second.reservation.id])).rejects.toThrow('appserver_canary_identity_immutable');
});
it('授权撤销和boot变化拒绝新start，但历史精确清理仍可达',async()=>{
 const {auth,authStore,capabilities,capacitySnapshot}=await prepare(),st=store();
 expect(st.reserveCanary).toBeTypeOf('function');
 await expect(st.reserveCanary({authorizationId:auth.id,sequence:1,capabilities:{...capabilities,worker_boot_id:randomUUID()},capacitySnapshot})).rejects.toThrow('appserver_canary_authorization_denied');
 // 清理前例所占机器，只有完整匹配的回执能释放。
 const {workerIdentity}=await import('../../identity.js');
 for(const row of await st.listOutstanding()){const pending=await st.requestCancel(row.id);await st.confirmCleanup(row.id,{authenticated:true,receipt:{...workerIdentity(pending),container_id:pending.container_id,challenge:pending.cleanup_challenge,status:'cleaned',absent:true,tombstoned:true}});}
 const result=await st.reserveCanary({authorizationId:auth.id,sequence:1,capabilities,capacitySnapshot});
 await authStore.revoke(auth.id);let called=false;
 await expect(st.withOperation(result.reservation.id,'start',()=>called=true)).rejects.toThrow('appserver_canary_authorization_denied');expect(called).toBe(false);
 await st.withOperation(result.reservation.id,'inspect',(_row,url)=>expect(url).toBe('http://m1:5231'));
});
