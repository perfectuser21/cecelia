import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {DB_DEFAULTS} from '../../db-config.js';
import {directory} from '../../execution-directory/directory.js';
import {importLegacyPolicy,revokeGrant} from '../../execution-directory/store.js';
import {LEGACY_BINDINGS} from '../../execution-directory/legacy-policy.js';
import {createAttemptStore} from '../../orchestrator/attempt-store.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
if(!/_(scratch|test)$/.test(process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname:DB_DEFAULTS.database))throw Error('scratch/test required');
const schema=`phone_dispatch_${process.pid}_${randomUUID().replaceAll('-','')}`;
const admin=new pg.Client(options),pool=new pg.Pool({...options,max:8,options:`-c search_path=${schema},public`});
const machine='xian-mac-m1',host='xian-m1',serial='test-phone',profile='test-profile',account='test-account';
let store;
const snapshot=()=>({verified:true,machine,captured_at:Date.now(),expires_at:Date.now()+30_000,capacity:{ok:true,available:1,physical_base_slots:8,effective_base_slots:8}});
async function input(){const taskId=randomUUID();await pool.query("INSERT INTO tasks(id,status,task_type,executor_kind) VALUES($1,'queued','dev','headed-session')",[taskId]);return {taskId,machineId:machine,host,serial,profileId:profile,account,capacitySnapshot:snapshot(),remoteIdentity:{worker_id:'remote-phone-worker',worker_boot_id:'remote-boot'}};}
const receipt=(r,extras={})=>({authenticated:true,receipt:{dispatch_id:r.id,...Object.fromEntries(['reservation_id','task_id','machine_id','host','serial','profile','account_id','execution_version_id','execution_grant_id','lease_token','execution_id','worker_id','worker_boot_id'].map(k=>[k,r[k]])),status:'completed',execution_exited:true,lock_released:true,lock_owner:r.lease_token,...extras}});
beforeAll(async()=>{
 await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,name TEXT,status TEXT,metadata JSONB DEFAULT '{}');
 CREATE TABLE tasks(id UUID PRIMARY KEY,status TEXT,result JSONB,updated_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,claimed_by TEXT,claimed_at TIMESTAMPTZ,payload JSONB DEFAULT '{}',task_type TEXT CONSTRAINT tasks_task_type_check CHECK(task_type IN ('dev')),executor_kind TEXT CONSTRAINT tasks_executor_kind_check CHECK(executor_kind IN ('headed-session')));
 CREATE TABLE initiative_runs(id UUID PRIMARY KEY,phase TEXT DEFAULT 'planning',map_recovery_contract_id UUID,orchestrator_version TEXT DEFAULT 'v2');CREATE TABLE map_recovery_consumptions(contract_id UUID,attempt_id UUID);
 CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ);`);
 for(const [,id,name]of LEGACY_BINDINGS)await pool.query("INSERT INTO system_registry(id,type,name,status) VALUES($1,'machine',$2,'active')",[id,name]);
 for(const name of ['357_harness_provider_attempts','362_kernel_attempt_telemetry_reconcile','363_kernel_fleet_execution_receipts','364_kernel_local_container_naming','425_harness_attempt_cleanup_outbox','490_phone_registry','501_capacity_reservations','503_execution_directory','504_app_server_generations','507_phone_dispatches'])await pool.query(readFileSync(new URL(`../../../migrations/${name}.sql`,import.meta.url),'utf8'));
 await importLegacyPolicy({pool,env:{FLEET_WORKER_XIAN_MAC_M1_URL:'http://m1:5231'}});
 expect((await pool.query("SELECT * FROM execution_grants WHERE surface='phone_ssh'")).rows).toHaveLength(0);
 await pool.query("INSERT INTO phone_registry(serial,nickname,host,profile,douyin_accounts) VALUES($1,'test',$2,$3,$4::jsonb)",[serial,host,profile,JSON.stringify([{id:account,current:true}])]);
 const {createPhoneDispatchStore}=await import('../../phone-dispatch/store.js');store=createPhoneDispatchStore({pool,afterTask:async()=>{}});
});
beforeEach(async()=>{
 await pool.query('TRUNCATE phone_dispatches,capacity_reservations,tasks,harness_attempt_cleanup_outbox,harness_attempts,initiative_runs CASCADE');
 await pool.query("INSERT INTO execution_grants(node_version_id,surface,provider,account_id,profile_id,provenance,state) SELECT current_version_id,'phone_ssh','adb',$1,$2,'test_explicit_policy','active' FROM execution_nodes WHERE canonical_id=$3 ON CONFLICT(node_version_id,surface,provider,account_id,repo_scope,profile_id) DO UPDATE SET state='active',expires_at=NULL",[account,profile,machine]);
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
 for(const sql of ["status='queued'","status='failed'","status='completed'","payload='{}'","executor_kind=NULL"])await expect(pool.query(`UPDATE tasks SET ${sql} WHERE id=$1`,[r.task_id])).rejects.toThrow('phone_task_managed');
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
 await store.finish(r.id,receipt(r));
 const other=await input();await pool.query(`INSERT INTO capacity_reservations(id,machine_id,owner_kind,owner_key,task_id,config_digest,allocation_mode,policy_version,snapshot_time,snapshot_digest) VALUES($1,$2,'app_server',$3,$4,$5,'exclusive_unclassified','test',now(),$5)`,[randomUUID(),machine,randomUUID(),other.taskId,'a'.repeat(64)]);
 expect((await store.reserve(await input())).outcome).toBe('wait');
});
