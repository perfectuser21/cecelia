import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import pg from 'pg';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {DB_DEFAULTS} from '../db-config.js';
import {directory} from '../execution-directory/directory.js';
import {importLegacyPolicy,revokeGrant} from '../execution-directory/store.js';
import {LEGACY_BINDINGS} from '../execution-directory/legacy-policy.js';
import {createAttemptStore} from '../orchestrator/attempt-store.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
if(!/_(scratch|test)$/.test(process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname:DB_DEFAULTS.database))throw Error('scratch/test required');
const schema=`phone_dispatch_${process.pid}_${randomUUID().replaceAll('-','')}`;
const admin=new pg.Client(options),pool=new pg.Pool({...options,max:8,options:`-c search_path=${schema},public`});
const machine='xian-mac-m1',host='xian-m1',serial='test-phone',profile='test-profile',account='test-account';
let store,sshVersion,migrationBefore,migrationAfter;
const snapshot=()=>({verified:true,machine,captured_at:Date.now(),expires_at:Date.now()+30_000,capacity:{ok:true,available:1,physical_base_slots:8,effective_base_slots:8}});
async function input(){const taskId=randomUUID();await pool.query("INSERT INTO tasks(id,status,task_type,executor_kind) VALUES($1,'queued','device_job','phone-ssh-controller')",[taskId]);return {taskId,machineId:machine,host,serial,profileId:profile,account,capacitySnapshot:snapshot(),remoteIdentity:{worker_id:'remote-phone-worker',worker_boot_id:'remote-boot'}};}
const receipt=(r,extras={})=>({authenticated:true,receipt:{dispatch_id:r.id,...Object.fromEntries(['reservation_id','task_id','machine_id','host','serial','profile','account_id','execution_version_id','execution_grant_id','lease_token','execution_id','worker_id','worker_boot_id','action','config_digest'].map(k=>[k,r[k]])),status:'completed',execution_exited:true,lock_released:true,lock_owner:r.lease_token,...extras}});
it('HTTP binding迁移不补写既有508 lease，不创建grant或改当前节点',async()=>{
 const {dispatch:r}=await store.reserve(await input());
 const before=(await pool.query('SELECT * FROM phone_dispatches WHERE id=$1',[r.id])).rows[0];
 const grants=(await pool.query('SELECT * FROM execution_grants ORDER BY id')).rows;
 const nodes=(await pool.query('SELECT * FROM execution_nodes ORDER BY canonical_id')).rows;
 await pool.query(readFileSync(new URL('../../migrations/510_phone_http_bindings.sql',import.meta.url),'utf8'));
 expect((await pool.query('SELECT * FROM phone_dispatches WHERE id=$1',[r.id])).rows[0]).toEqual(before);
 expect((await pool.query('SELECT * FROM execution_grants ORDER BY id')).rows).toEqual(grants);
 expect((await pool.query('SELECT * FROM execution_nodes ORDER BY canonical_id')).rows).toEqual(nodes);
});
beforeAll(async()=>{
 await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,name TEXT,status TEXT,metadata JSONB DEFAULT '{}');
 CREATE TABLE tasks(id UUID PRIMARY KEY,status TEXT,result JSONB,updated_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,claimed_by TEXT,claimed_at TIMESTAMPTZ,payload JSONB DEFAULT '{}',task_type TEXT CONSTRAINT tasks_task_type_check CHECK(task_type IN ('dev','device_job')),executor_kind TEXT CONSTRAINT tasks_executor_kind_check CHECK(executor_kind IN ('headed-session')));
 CREATE TABLE initiative_runs(id UUID PRIMARY KEY,phase TEXT DEFAULT 'planning',map_recovery_contract_id UUID,orchestrator_version TEXT DEFAULT 'v2');CREATE TABLE map_recovery_consumptions(contract_id UUID,attempt_id UUID);
 CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ);`);
 for(const [,id,name]of LEGACY_BINDINGS)await pool.query("INSERT INTO system_registry(id,type,name,status) VALUES($1,'machine',$2,'active')",[id,name]);
 for(const name of ['357_harness_provider_attempts','362_kernel_attempt_telemetry_reconcile','363_kernel_fleet_execution_receipts','364_kernel_local_container_naming','425_harness_attempt_cleanup_outbox','490_phone_registry','501_capacity_reservations','503_execution_directory','504_app_server_generations','507_linux_script_authorization','508_phone_dispatches'])await pool.query(readFileSync(new URL(`../../migrations/${name}.sql`,import.meta.url),'utf8'));
 await importLegacyPolicy({pool,env:{FLEET_WORKER_XIAN_MAC_M1_URL:'http://m1:5231'}});
 const old=(await pool.query('SELECT * FROM execution_node_versions WHERE id=(SELECT current_version_id FROM execution_nodes WHERE canonical_id=$1)',[machine])).rows[0];
 const version=randomUUID();sshVersion=version;await pool.query(`INSERT INTO execution_node_versions(id,machine_registry_id,revision,identity_mode,worker_id,platform,endpoints,profile,config_hash,state) VALUES($1,$2,2,'legacy-v1',$3,'darwin',$4,$5,$6,'active')`,[version,old.machine_registry_id,old.worker_id,{phone_ssh:{host,port:22,user:'administrator',hub:{host:'us-vps',port:22,user:'administrator'}}},old.profile,old.config_hash]);
 await pool.query('UPDATE execution_nodes SET current_version_id=$1 WHERE canonical_id=$2',[version,machine]);
 expect((await pool.query("SELECT * FROM execution_grants WHERE surface='phone_ssh'")).rows).toHaveLength(0);
 await pool.query("INSERT INTO phone_registry(serial,nickname,host,profile,douyin_accounts) VALUES($1,'test',$2,$3,$4::jsonb)",[serial,host,profile,JSON.stringify([{id:account,current:true}])]);
 // Seed an actual 508 row before 512; ALTER must preserve identity, grants and pointer.
 const taskId=randomUUID(),id=randomUUID(),reservation=randomUUID(),execution=randomUUID(),lease=randomUUID();
 const grant=(await pool.query("INSERT INTO execution_grants(node_version_id,surface,provider,account_id,profile_id,provenance,state) VALUES($1,'phone_ssh','adb',$2,'adb_get_state','isolated_migration_fixture','active') RETURNING id",[version,account])).rows[0].id;
 await pool.query("INSERT INTO tasks(id,status,task_type,executor_kind) VALUES($1,'queued','device_job','phone-ssh-controller')",[taskId]);
 await pool.query(`INSERT INTO capacity_reservations(id,machine_id,owner_kind,owner_key,task_id,config_digest,allocation_mode,policy_version,snapshot_time,snapshot_digest,intent_id,worker_id,worker_boot_id,execution_version_id,execution_grant_id)
  VALUES($1,$2,'phone',$3,$4,$5,'exclusive_unclassified','fixture',now(),$5,$6,'fixture-worker','fixture-boot',$7,$8)`,[reservation,machine,`phone-${id}`,taskId,'f'.repeat(64),execution,version,grant]);
 await pool.query(`INSERT INTO phone_dispatches(id,task_id,reservation_id,serial,machine_id,host,profile,account_id,execution_version_id,execution_grant_id,lease_token,execution_id,worker_id,worker_boot_id,config_digest)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'fixture-worker','fixture-boot',$13)`,[id,taskId,reservation,serial,machine,host,profile,account,version,grant,lease,execution,'f'.repeat(64)]);
 const capture=async()=>({row:(await pool.query('SELECT * FROM phone_dispatches WHERE id=$1',[id])).rows[0],grants:(await pool.query('SELECT * FROM execution_grants ORDER BY id')).rows,nodes:(await pool.query('SELECT * FROM execution_nodes ORDER BY canonical_id')).rows});
 migrationBefore=await capture();
 const httpLeaseMigration=new URL('../../migrations/512_phone_http_leases.sql',import.meta.url);if(existsSync(httpLeaseMigration))await pool.query(readFileSync(httpLeaseMigration,'utf8'));
 migrationAfter=await capture();
 const {createPhoneDispatchStore}=await import('./store.js');store=createPhoneDispatchStore({pool,afterTask:async()=>{}});
});

async function httpVersion(){
 const original=(await pool.query('SELECT v.* FROM execution_nodes n JOIN execution_node_versions v ON n.current_version_id=v.id WHERE n.canonical_id=$1',[machine])).rows[0];
 const revision=Number((await pool.query('SELECT max(revision) AS n FROM execution_node_versions WHERE machine_registry_id=$1',[original.machine_registry_id])).rows[0].n)+1;
 const binding={http_endpoint:'http://127.0.0.1:3459/',hub_id:'fixture-hub',hub_boot_id:'fixture-hub-boot',hub_config_digest:'a'.repeat(64),hub_build_digest:'b'.repeat(64),physical:{machine_id:machine,worker_id:original.worker_id,physical_boot_id:'fixture-phone-boot',config_digest:'c'.repeat(64),build_digest:'d'.repeat(64),action_digest:'e'.repeat(64)}};
 const id=randomUUID();await pool.query(`INSERT INTO execution_node_versions(id,machine_registry_id,revision,identity_mode,worker_id,worker_boot_id,platform,endpoints,profile,config_hash,state)
  VALUES($1,$2,$3,'legacy-v1',$4,$5,'darwin',$6,$7,$8,'active')`,[id,original.machine_registry_id,revision,original.worker_id,binding.physical.physical_boot_id,{...original.endpoints,phone_hub:binding},original.profile,original.config_hash]);
 await pool.query('UPDATE execution_nodes SET current_version_id=$1 WHERE canonical_id=$2',[id,machine]);
 await pool.query("INSERT INTO execution_grants(node_version_id,surface,provider,account_id,profile_id,provenance,state) VALUES($1,'phone_ssh','adb',$2,'adb_get_state','isolated_c1_test','active')",[id,account]);
 await directory.refresh({pool});return {id,binding};
}
async function httpInput(){const {remoteIdentity,...value}=await input();return value;}
it('C1真实旧508租约维持SSH/null，不补造HTTP身份',async()=>{
 const {transport_mode,http_binding,...original}=migrationAfter.row;expect(transport_mode).toBe('ssh');expect(http_binding).toBe(null);expect(original).toEqual(migrationBefore.row);
 expect(migrationAfter.grants).toEqual(migrationBefore.grants);expect(migrationAfter.nodes).toEqual(migrationBefore.nodes);
 const {dispatch:r}=await store.reserve(await input());
 expect(r.transport_mode).toBe('ssh');expect(r.http_binding).toBe(null);
 const {resolvePhoneHttpLeaseBinding}=await import('./http-binding.js');
 await expect(resolvePhoneHttpLeaseBinding(pool,{dispatchId:r.id})).rejects.toThrow('phone_http_lease_binding_unavailable');
 expect((await store.get(r.id)).http_binding).toBe(null);
});
it('C1真正DB版本完整快照持久化；worker/boot来自版本，不取caller',async()=>{
 const v=await httpVersion(),request=await httpInput(),{dispatch:r}=await store.reserveHttp(request);
 expect(r.transport_mode).toBe('http');expect(r.http_binding).toEqual({execution_version_id:v.id,...v.binding});
 expect(r.worker_id).toBe(v.binding.physical.worker_id);expect(r.worker_boot_id).toBe(v.binding.physical.physical_boot_id);
 expect((await pool.query('SELECT http_binding FROM phone_dispatches WHERE id=$1',[r.id])).rows[0].http_binding).toEqual(r.http_binding);
 const {resolvePhoneHttpLeaseBinding,isPhoneHttpLeaseBinding,isPhoneHubBinding}=await import('./http-binding.js');
 const b=await resolvePhoneHttpLeaseBinding(pool,{dispatchId:r.id});expect(isPhoneHttpLeaseBinding(b)).toBe(true);expect(isPhoneHubBinding(b)).toBe(true);
 expect(isPhoneHttpLeaseBinding({...b})).toBe(false);expect(isPhoneHubBinding({...b})).toBe(false);expect(Object.isFrozen(b.physical)).toBe(true);
 expect(b).toMatchObject({dispatch_id:r.id,task_id:r.task_id,lease_token:r.lease_token,execution_grant_id:r.execution_grant_id,...r.http_binding});
});
it('C1历史lease在current换版与grant撤销/过期后仍读原快照，未知不另起',async()=>{
 const original=await httpVersion(),request=await httpInput(),{dispatch:r}=await store.reserveHttp(request);
 await store.recordUnknown(r.id,'isolated delivery unknown');await httpVersion();
 await pool.query("UPDATE execution_grants SET state='revoked',expires_at=now()-interval '1 second' WHERE id=$1",[r.execution_grant_id]);
 const {resolvePhoneHttpLeaseBinding}=await import('./http-binding.js');
 const b=await resolvePhoneHttpLeaseBinding(pool,{dispatchId:r.id});expect(b.execution_version_id).toBe(original.id);expect(b).toMatchObject(r.http_binding);
 expect((await store.reserveHttp(request)).dispatch.id).toBe(r.id);expect((await store.reserveHttp(request)).outcome).toBe('unknown');
 expect((await pool.query('SELECT status FROM capacity_reservations WHERE id=$1',[r.reservation_id])).rows[0].status).toBe('cleanup_pending');
});
it('C1 HTTP快照及mode不可改；伪造/缺字段/错历史版本的INSERT被DB拒绝',async()=>{
 await httpVersion();const {dispatch:r}=await store.reserveHttp(await httpInput());
 for(const sql of ["http_binding='{}'","http_binding=NULL","transport_mode='ssh'"])await expect(pool.query(`UPDATE phone_dispatches SET ${sql} WHERE id=$1`,[r.id])).rejects.toThrow('phone_identity_immutable');
 const candidates=[{},null,{...r.http_binding,execution_version_id:randomUUID()},{...r.http_binding,http_endpoint:'http://evil:3459/'},{...r.http_binding,available:1}];
 for(const key of Object.keys(r.http_binding)){const b=structuredClone(r.http_binding);delete b[key];candidates.push(b);}
 for(const key of Object.keys(r.http_binding.physical)){const b=structuredClone(r.http_binding);delete b.physical[key];candidates.push(b);}
 for(const http_binding of candidates)await expect(pool.query('INSERT INTO phone_dispatches SELECT (jsonb_populate_record(NULL::phone_dispatches,$1::jsonb)).*',[JSON.stringify({...r,http_binding})])).rejects.toThrow('phone_http_lease_identity_mismatch');
});
it('C1缺目录HTTP身份／callerURL／克隆binding／错worker不能借默认许可',async()=>{
 await expect(store.reserveHttp(await httpInput())).rejects.toThrow('phone_http_binding_unavailable');
 const v=await httpVersion(),request=await httpInput();
 for(const patch of [{httpBinding:{execution_version_id:v.id,...v.binding}},{http_endpoint:'http://evil:3459/'},{executionVersionId:randomUUID()},{remoteIdentity:{worker_id:'caller',worker_boot_id:'caller'}}])await expect(store.reserveHttp({...request,...patch})).rejects.toThrow();
 expect((await pool.query('SELECT * FROM phone_dispatches')).rows).toHaveLength(0);
});
it('C1 HTTP执行仍默认拒绝，旧receipt不能finish，DB不能进入launching',async()=>{
 await httpVersion();const {dispatch:r}=await store.reserveHttp(await httpInput());let calls=0;
 await expect(store.withLaunch(r.id,()=>{calls++;})).rejects.toThrow('phone_http_execution_not_connected');
 await expect(store.observe(r.id,receipt(r,{status:'running'}))).rejects.toThrow('phone_http_execution_not_connected');
 await expect(store.finish(r.id,receipt(r))).rejects.toThrow('phone_http_execution_not_connected');
 await expect(pool.query("UPDATE phone_dispatches SET state='launching' WHERE id=$1",[r.id])).rejects.toThrow('phone_http_execution_not_connected');
 expect(calls).toBe(0);expect((await store.get(r.id)).state).toBe('reserved');
});
it('C1同task跨mode拒绝，HTTP唯一预约仍遵守整机shared占位',async()=>{
 await httpVersion();const request=await httpInput();
 const [a,b]=await Promise.all([store.reserveHttp(request),store.reserveHttp(request)]);expect(a.dispatch.id).toBe(b.dispatch.id);
 await expect(store.reserve({...request,remoteIdentity:{worker_id:'old',worker_boot_id:'old'}})).rejects.toThrow('phone_transport_conflict');
 expect((await store.reserveHttp(await httpInput())).outcome).toBe('wait');
});
beforeEach(async()=>{
 await pool.query('UPDATE execution_nodes SET current_version_id=$1 WHERE canonical_id=$2',[sshVersion,machine]);
 await pool.query('TRUNCATE phone_dispatches,capacity_reservations,tasks,harness_attempt_cleanup_outbox,harness_attempts,initiative_runs CASCADE');
 await pool.query("INSERT INTO execution_grants(node_version_id,surface,provider,account_id,profile_id,provenance,state) SELECT current_version_id,'phone_ssh','adb',$1,$2,'test_explicit_policy','active' FROM execution_nodes WHERE canonical_id=$3 ON CONFLICT(node_version_id,surface,provider,account_id,repo_scope,profile_id) DO UPDATE SET state='active',expires_at=NULL",[account,'adb_get_state',machine]);
 await pool.query('UPDATE phone_registry SET enabled=true WHERE serial=$1',[serial]);await directory.refresh({pool});
});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});
it('task 并发唯一；unknown 不释放、不另起',async()=>{
 const v=await input(),[a,b]=await Promise.all([store.reserve(v),store.reserve(v)]);expect(a.dispatch.id).toBe(b.dispatch.id);
 const r=await store.recordUnknown(a.dispatch.id,'lost ssh reply');expect(r.state).toBe('unknown');
 expect((await store.reserve({...v,capacitySnapshot:null})).dispatch.id).toBe(r.id);
 await expect(store.withLaunch(r.id,()=>{throw Error('must not launch');})).rejects.toThrow('phone_launch_forbidden');
 expect((await pool.query('SELECT status FROM capacity_reservations')).rows).toEqual([{status:'cleanup_pending'}]);
});
it('撤销与过期 grant 拒绝 reserve/start；既有占位不释放',async()=>{
 const {dispatch:r}=await store.reserve(await input());await revokeGrant({pool,grantId:r.execution_grant_id});
 await expect(store.withLaunch(r.id,()=>{})).rejects.toThrow('execution_grant_denied');
 await expect(store.reserve(await input())).rejects.toThrow('execution_grant_denied');
 await pool.query("UPDATE execution_grants SET state='active',expires_at=now()-interval '1 second' WHERE id=$1",[r.execution_grant_id]);await directory.refresh({pool});
 await expect(store.reserve(await input())).rejects.toThrow('execution_grant_denied');expect((await store.get(r.id)).state).toBe('reserved');
});
it('台账身份与未知新鲜度拒绝',async()=>{
 const v=await input();for(const extra of [{host:'foreign'},{profileId:'foreign'},{account:'foreign'}])await expect(store.reserve({...v,...extra})).rejects.toThrow();
 await pool.query('UPDATE phone_registry SET enabled=false WHERE serial=$1',[serial]);await expect(store.reserve(v)).rejects.toThrow('phone_registry_mismatch');
 await pool.query('UPDATE phone_registry SET enabled=true WHERE serial=$1',[serial]);
 for(const capacitySnapshot of [null,{...snapshot(),captured_at:undefined},{...snapshot(),expires_at:undefined},{...snapshot(),captured_at:Date.now()-90_000}])expect((await store.reserve({...v,capacitySnapshot})).outcome).toBe('wait');
});
it('旧 writer 回队、终态与重绑被 DB guard 拒绝；未受管 task 不受影响',async()=>{
 const {dispatch:r}=await store.reserve(await input());
 for(const sql of ["status='queued'","status='failed'","status='completed'","payload='{}'","executor_kind=NULL","claimed_by=NULL,claimed_at=NULL"])await expect(pool.query(`UPDATE tasks SET ${sql} WHERE id=$1`,[r.task_id])).rejects.toThrow('phone_task_managed');
 await expect(pool.query('UPDATE phone_dispatches SET serial=$2 WHERE id=$1',[r.id,'other'])).rejects.toThrow('phone_identity_immutable');
 const v=await input();await expect(pool.query("UPDATE tasks SET status='completed' WHERE id=$1",[v.taskId])).resolves.toMatchObject({rowCount:1});
});
it('强绑定确认后同内容重复幂等，冲突终态拒绝',async()=>{
 const {dispatch:r}=await store.reserve(await input());await store.recordUnknown(r.id,'lost');
 for(const verified of [{...receipt(r),authenticated:false},receipt(r,{serial:'wrong'}),receipt(r,{execution_exited:false}),receipt(r,{lock_released:false}),receipt(r,{lock_owner:'foreign'})])await expect(store.finish(r.id,verified)).rejects.toThrow('phone_receipt_mismatch');
 expect((await store.finish(r.id,receipt(r))).state).toBe('terminal');expect((await store.finish(r.id,receipt(r))).id).toBe(r.id);
 await expect(store.finish(r.id,receipt(r,{status:'failed'}))).rejects.toThrow('phone_terminal_conflict');
 expect((await pool.query('SELECT status FROM tasks WHERE id=$1',[r.task_id])).rows[0].status).toBe('completed');
 expect((await pool.query('SELECT status FROM capacity_reservations WHERE id=$1',[r.reservation_id])).rows[0].status).toBe('released');
 await expect(pool.query("UPDATE tasks SET status='failed' WHERE id=$1",[r.task_id])).rejects.toThrow('phone_task_managed');
});
it('launch 一次且认证追认 running，unknown 不再 launch',async()=>{
 const {dispatch:r}=await store.reserve(await input());let calls=0;await store.withLaunch(r.id,()=>{calls++;});expect(calls).toBe(1);
 await expect(store.withLaunch(r.id,()=>{calls++;})).rejects.toThrow('phone_launch_forbidden');
 await store.recordUnknown(r.id,'lost');expect((await store.observe(r.id,receipt(r,{status:'running'}))).state).toBe('running');expect(calls).toBe(1);
});
it('同 machine 与真实 Harness、shared app-server owner 互斥',async()=>{
 const {dispatch:r}=await store.reserve(await input());const runId=randomUUID();await pool.query('INSERT INTO initiative_runs(id) VALUES($1)',[runId]);
 await expect(createAttemptStore(pool).createAttempt({id:randomUUID(),runId,hop:1,phase:'generate',role:'reporter',provider:'codex',machineId:machine,callbackSecretHash:'a'.repeat(64),bundle:{inputs:{}},capacitySnapshot:snapshot()})).rejects.toThrow('capacity_contended');
 await store.withLaunch(r.id,()=>{});await store.finish(r.id,receipt(r));
 const other=await input();await pool.query(`INSERT INTO capacity_reservations(id,machine_id,owner_kind,owner_key,task_id,config_digest,allocation_mode,policy_version,snapshot_time,snapshot_digest) VALUES($1,$2,'app_server',$3,$4,$5,'exclusive_unclassified','test',now(),$5)`,[randomUUID(),machine,randomUUID(),other.taskId,'a'.repeat(64)]);
 expect((await store.reserve(await input())).outcome).toBe('wait');
});
it('旧 writer 不能先释放 capacity 或伪造其它执行的终态回执',async()=>{
 const {dispatch:r}=await store.reserve(await input());
 await expect(pool.query("UPDATE capacity_reservations SET status='released',released_at=now(),confirmed_receipt='{}' WHERE id=$1",[r.reservation_id])).rejects.toThrow('phone_release_unconfirmed');
 await store.withLaunch(r.id,()=>{});
 const wrong=receipt(r,{serial:'foreign'}).receipt;
 await expect(pool.query("UPDATE phone_dispatches SET state='terminal',terminal_receipt=$2::jsonb,terminal_digest=$3,terminal_status='completed' WHERE id=$1",[r.id,JSON.stringify(wrong),'a'.repeat(64)])).rejects.toThrow('phone_terminal_receipt_required');
 expect((await store.get(r.id)).state).toBe('launching');
});
it('远端操作开始前 launch 意图已提交；响应丢失和实例重建均不重启',async()=>{
 const {dispatch:r}=await store.reserve(await input());
 await expect(store.withLaunch(r.id,async(row,endpoint)=>{
  expect((await pool.query('SELECT state FROM phone_dispatches WHERE id=$1',[r.id])).rows[0].state).toBe('launching');
  expect(endpoint.hub.host).toBe('us-vps');expect(row.action).toBe('adb_get_state');throw Error('response_lost');
 })).rejects.toThrow('response_lost');
 const {createPhoneDispatchStore}=await import('./store.js');const fresh=createPhoneDispatchStore({pool,afterTask:async()=>{}});
 expect((await fresh.get(r.id)).state).toBe('unknown');await expect(fresh.withLaunch(r.id,()=>{})).rejects.toThrow('phone_launch_forbidden');
});
it('能力严格限定 adb_get_state，持久 grant 与phone profile分开',async()=>{
 const v=await input();await expect(store.reserve({...v,action:'harvest'})).rejects.toThrow('phone_request_invalid');
 const {dispatch:r}=await store.reserve(v);expect(r.profile).toBe(profile);expect(r.action).toBe('adb_get_state');
 expect((await pool.query('SELECT profile_id FROM execution_grants WHERE id=$1',[r.execution_grant_id])).rows[0].profile_id).toBe('adb_get_state');
 await expect(store.reserve({...v,host:'foreign'})).rejects.toThrow('phone_configuration_conflict');
});
it('phone 与真实 Harness 同机并发只有一方落预约',async()=>{
 const v=await input(),runId=randomUUID();await pool.query('INSERT INTO initiative_runs(id) VALUES($1)',[runId]);
 const outcomes=await Promise.allSettled([store.reserve(v),createAttemptStore(pool).createAttempt({id:randomUUID(),runId,hop:1,phase:'generate',role:'reporter',provider:'codex',machineId:machine,callbackSecretHash:'a'.repeat(64),bundle:{inputs:{}},capacitySnapshot:snapshot()})]);
 expect(outcomes.some(o=>o.status==='fulfilled')).toBe(true);
 expect(Number((await pool.query('SELECT (SELECT count(*) FROM phone_dispatches)+(SELECT count(*) FROM harness_attempts) AS n')).rows[0].n)).toBe(1);
});

it('任意 dev 或旧 openclaw executor 身份不能占手机派发',async()=>{
 const v=await input();await pool.query("UPDATE tasks SET task_type='dev',executor_kind='headed-session' WHERE id=$1",[v.taskId]);
 await expect(store.reserve(v)).rejects.toThrow('phone_task_identity_invalid');
});

it('reserved 未launch不接受completed；unknown retry明确返回未知且不得重新启动',async()=>{
 const v=await input(),{dispatch:r}=await store.reserve(v);await expect(store.finish(r.id,receipt(r))).rejects.toThrow('phone_completion_before_launch');
 await store.recordUnknown(r.id,'unknown');expect((await store.reserve(v)).outcome).toBe('unknown');
});
it('仅worker HTTP endpoint不能取得手机授权，缺hub同样拒绝',async()=>{
 const original=(await pool.query('SELECT v.* FROM execution_node_versions v JOIN execution_nodes n ON n.current_version_id=v.id WHERE n.canonical_id=$1',[machine])).rows[0];
 try{
  for(const endpoints of [{worker:'http://m1:5231'},{phone_ssh:{host,port:22,user:'administrator'}}]){
   const revision=Number((await pool.query('SELECT max(revision) AS n FROM execution_node_versions WHERE machine_registry_id=$1',[original.machine_registry_id])).rows[0].n)+1;
   const version=randomUUID();await pool.query("INSERT INTO execution_node_versions(id,machine_registry_id,revision,identity_mode,worker_id,platform,endpoints,profile,config_hash,state) VALUES($1,$2,$3,'legacy-v1',$4,'darwin',$5,$6,$7,'active')",[version,original.machine_registry_id,revision,original.worker_id,endpoints,original.profile,original.config_hash]);
   await pool.query('UPDATE execution_nodes SET current_version_id=$1 WHERE canonical_id=$2',[version,machine]);
   await pool.query("INSERT INTO execution_grants(node_version_id,surface,provider,account_id,profile_id,provenance,state) VALUES($1,'phone_ssh','adb',$2,'adb_get_state','test','active')",[version,account]);await directory.refresh({pool});
   await expect(store.reserve(await input())).rejects.toThrow('execution_version_stale');
  }
 }finally{await pool.query('UPDATE execution_nodes SET current_version_id=$1 WHERE canonical_id=$2',[original.id,machine]);await directory.refresh({pool});}
});
it('同机锁等待直到snapshot过期，最终拒绝且不留下预约/ledger',async()=>{
 const v=await input();v.capacitySnapshot.expires_at=Date.now()+50;
 const blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('harness_attempt_machine:'||$1,0))",[machine]);
 const pending=store.reserve(v);await new Promise(r=>setTimeout(r,80));await blocker.query('COMMIT');blocker.release();
 expect((await pending).outcome).toBe('wait');expect((await pool.query('SELECT * FROM phone_dispatches')).rows).toHaveLength(0);expect((await pool.query('SELECT * FROM capacity_reservations')).rows).toHaveLength(0);
});
it('phone 与真实 script store 共用整机容量，无owner借道',async()=>{
 const {createScriptReservationStore}=await import('../orchestrator/script-reservation-store.js');const scripts=createScriptReservationStore(pool);
 const {dispatch:r}=await store.reserve(await input()),scriptTask=await input();
 const req={taskId:scriptTask.taskId,machineId:machine,ownerKey:`script-${scriptTask.taskId}-a1`,configDigest:'a'.repeat(64),capacitySnapshot:snapshot()};
 expect((await scripts.reserve(req)).outcome).toBe('wait');
 await store.withLaunch(r.id,()=>{});await store.finish(r.id,receipt(r));expect((await scripts.reserve(req)).outcome).toBe('reserved');
 expect((await store.reserve(await input())).outcome).toBe('wait');
});
it.each(['grant','snapshot'])('registry 行锁等待越过 %s 期限时最终launch拒绝且unknown保留占位',async(kind)=>{
 const {dispatch:r}=await store.reserve(await input()),blocker=await pool.connect();
 const expires=Date.now()+200,snapshotForLaunch={...directory.current(),expiresAt:kind==='snapshot'?expires:Date.now()+30_000};
 if(kind==='grant')await pool.query('UPDATE execution_grants SET expires_at=to_timestamp($2/1000.0) WHERE id=$1',[r.execution_grant_id,expires]);
 await blocker.query('BEGIN');await blocker.query('SELECT serial FROM phone_registry WHERE serial=$1 FOR UPDATE',[serial]);
 let calls=0,waiting=false;
 const pending=directory.withSnapshot(snapshotForLaunch,()=>store.withLaunch(r.id,()=>{calls++;return 'launched';})).then(value=>value,error=>error);
 try{
  for(let i=0;i<100;i++){
   const wait=(await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT * FROM phone_registry%') AS waiting")).rows[0].waiting;
   if(wait){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,5));
  }
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,expires-Date.now()+20)));
 }finally{await blocker.query('COMMIT');blocker.release();}
 const result=await pending;expect(waiting).toBe(true);expect(result).toBeInstanceOf(Error);
 expect(result.message).toBe(kind==='grant'?'execution_grant_denied':'execution_snapshot_unavailable');expect(calls).toBe(0);
 expect((await store.get(r.id)).state).toBe('unknown');
 expect((await pool.query('SELECT status FROM capacity_reservations WHERE id=$1',[r.reservation_id])).rows[0].status).toBe('cleanup_pending');
 await expect(store.withLaunch(r.id,()=>{calls++;})).rejects.toThrow('phone_launch_forbidden');expect(calls).toBe(0);
});
it('finish 保留已写handoff；提交后真实pool上的接棒入口仍能读取下一棒',async()=>{
 const {createPhoneDispatchStore}=await import('./store.js'),v=await input();
 const handoff={schema_version:1,summary:'existing',next_steps:[{kind:'task',title:'next baton'}]};
 await pool.query('UPDATE tasks SET result=$2::jsonb WHERE id=$1',[v.taskId,JSON.stringify({handoff,other_evidence:'preserve'})]);
 let calls=0;
 const checked=createPhoneDispatchStore({pool,afterTask:async(db,taskId,status)=>{
  expect(db).toBe(pool);expect(taskId).toBe(v.taskId);expect(status).toBe('completed');calls++;
  const committed=(await db.query('SELECT status,result FROM tasks WHERE id=$1',[taskId])).rows[0];
  expect(committed.status).toBe('completed');expect(committed.result.handoff).toEqual(handoff);
  expect(committed.result.other_evidence).toBe('preserve');
 }});
 const {dispatch:r}=await checked.reserve(v);await checked.withLaunch(r.id,()=>{});await checked.finish(r.id,receipt(r));
 expect(calls).toBe(1);expect((await pool.query('SELECT result FROM tasks WHERE id=$1',[v.taskId])).rows[0].result.handoff).toEqual(handoff);
 await checked.finish(r.id,receipt(r));expect(calls).toBe(1);
});

it('已部署Linux507、手机508、Hub510与C1 512各自留schema_version，不抢用同一版本号',async()=>{
 const rows=(await pool.query("SELECT version,description FROM schema_version WHERE version IN ('507','508','510','512') ORDER BY version")).rows;
 expect(rows.map(row=>row.version)).toEqual(['507','508','510','512']);
 expect(rows[0].description).not.toContain('手机独立');
 expect(rows[1].description).toContain('手机独立');
});
