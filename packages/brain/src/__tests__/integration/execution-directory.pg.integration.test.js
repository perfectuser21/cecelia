import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { beforeAll,afterAll,it,expect } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { directory } from '../../execution-directory/directory.js';
import { importLegacyPolicy,authorize,resolveCleanup,revokeGrant } from '../../execution-directory/store.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import { createScriptReservationStore } from '../../orchestrator/script-reservation-store.js';
import { createTransportAuthority } from '../../execution-directory/transport-authority.js';
import { LEGACY_BINDINGS } from '../../execution-directory/legacy-policy.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
const database=process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname.slice(1):DB_DEFAULTS.database;
if(!/_(scratch|test)$/.test(database))throw Error('scratch/test database required');
const schema=`execution_directory_${process.pid}_${randomUUID().replaceAll('-','')}`;
const admin=new pg.Client(options);const pool=new pg.Pool({...options,max:8,options:`-c search_path=${schema},public`});
const env={FLEET_WORKER_US_MAC_M4_URL:'http://mmv:5231',FLEET_WORKER_XIAN_MAC_M1_URL:'http://m1:5231',FLEET_WORKER_XIAN_MAC_M4_URL:'http://m4:5231'};
const request=()=>({snapshotVersion:directory.current().version,machineId:'us-mac-m4',surface:'harness',provider:'codex',account:'team1',repo:'perfectuser21/cecelia'});
beforeAll(async()=>{await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,name TEXT,status TEXT,metadata JSONB DEFAULT '{}');CREATE TABLE tasks(id UUID PRIMARY KEY,status TEXT);CREATE TABLE initiative_runs(id UUID PRIMARY KEY,phase TEXT DEFAULT 'planning',map_recovery_contract_id UUID,orchestrator_version TEXT DEFAULT 'v2');CREATE TABLE map_recovery_consumptions(contract_id UUID,attempt_id UUID);CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ);`);
 for(const [,id,name]of LEGACY_BINDINGS)await pool.query("INSERT INTO system_registry(id,type,name,status) VALUES($1,'machine',$2,'active')",[id,name]);
 for(const name of ['357_harness_provider_attempts','362_kernel_attempt_telemetry_reconcile','363_kernel_fleet_execution_receipts','364_kernel_local_container_naming','425_harness_attempt_cleanup_outbox','501_capacity_reservations'])await pool.query(readFileSync(new URL(`../../../migrations/${name}.sql`,import.meta.url),'utf8'));
 await pool.query(readFileSync(new URL('../../../migrations/503_execution_directory.sql',import.meta.url),'utf8'));
 await importLegacyPolicy({pool,env});await directory.refresh({pool});
});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});
it('真实迁移与导入精确18+2，重复启动不会复活撤销授权',async()=>{
 expect(directory.targets()).toHaveLength(18);expect(Number((await pool.query('SELECT count(*) FROM execution_grants')).rows[0].count)).toBe(20);
 const auth=await authorize(pool,request());await revokeGrant({pool,grantId:auth.grantId});await importLegacyPolicy({pool,env});
 await expect(authorize(pool,request())).rejects.toThrow('execution_grant_denied');
 expect((await pool.query('SELECT state FROM execution_grants WHERE id=$1',[auth.grantId])).rows[0].state).toBe('revoked');
});
it('metadata声明executor及未知机器均不能取得目录授权',async()=>{
 await pool.query("UPDATE system_registry SET metadata='{\"executors\":[\"codex\"]}' WHERE id=$1",[LEGACY_BINDINGS[1][1]]);
 await expect(authorize(pool,{...request(),machineId:'xian-mac-m1',surface:'legacy_executor',account:''})).rejects.toThrow('execution_grant_denied');
 await expect(authorize(pool,{...request(),machineId:'new-node'})).rejects.toThrow('execution_node_unavailable');
});
it('设备canonical不可重绑，配置immutable，缺失attestation禁止激活',async()=>{
 await expect(pool.query("UPDATE execution_nodes SET canonical_id='other'")).rejects.toThrow('execution_identity_immutable');
 await expect(pool.query("UPDATE execution_node_versions SET endpoints='{}'")).rejects.toThrow('execution_version_immutable');
 await expect(pool.query(`INSERT INTO execution_node_versions(machine_registry_id,revision,identity_mode,worker_id,platform,endpoints,profile,config_hash,state) VALUES($1,2,'attested-v1','worker','linux','{}','{}','hash','active')`,[LEGACY_BINDINGS[0][1]])).rejects.toThrow();
});
it('旧版本撤销后仍按原endpoint清理；换endpoint必须插新revision',async()=>{
 const a=await authorize(pool,{...request(),account:'team2'});
 await revokeGrant({pool,grantId:a.grantId});
 const clean=await resolveCleanup(pool,{executionVersionId:a.executionVersionId,persistedAttemptIdentity:{machine_id:'us-mac-m4'}});
 expect(clean.endpoints.worker).toBe('http://mmv:5231');
 await expect(resolveCleanup(pool,{executionVersionId:a.executionVersionId,persistedAttemptIdentity:{machine_id:'xian-mac-m1'}})).rejects.toThrow('execution_cleanup_identity_mismatch');
});
it('最终launch持有同机锁，撤销与launch串行；撤销提交后新增拒绝',async()=>{
 const req={...request(),account:'team3'};let unlocked;const hold=new Promise(r=>unlocked=r);let admitted;const started=new Promise(r=>admitted=r);
 const launch=authorize(pool,req,async a=>{admitted(a);await hold;return a;});const auth=await started;
 let revoked=false;const revoking=revokeGrant({pool,grantId:auth.grantId}).then(()=>{revoked=true;});
 await new Promise(r=>setTimeout(r,30));expect(revoked).toBe(false);unlocked();await launch;await revoking;
 await expect(authorize(pool,request())).rejects.toThrow('execution_grant_denied');
});

const capacitySnapshot=()=>({verified:true,machine:'xian-mac-m1',expires_at:Date.now()+60_000,capacity:{ok:true,available:8,physical_base_slots:8,effective_base_slots:8}});
it('实际Harness预约剥离伪造字段并持久化精确版本；最终prepare拒绝被撤销授权',async()=>{
 const runId=randomUUID();await pool.query("INSERT INTO initiative_runs(id) VALUES($1)",[runId]);
 const input={id:randomUUID(),runId,hop:1,phase:'planning',role:'reporter',provider:'codex',accountId:'team1',machineId:'xian-mac-m1',callbackSecretHash:'a'.repeat(64),capacitySnapshot:capacitySnapshot(),
  bundle:{inputs:{execution_surface:'fleet-worker',workspace_spec:{repo:'perfectuser21/cecelia'},_server_execution:{executionVersionId:randomUUID(),grantId:randomUUID()}}}};
 const store=createAttemptStore(pool,{executionDirectory:true});const result=await store.createAttempt(input);const a=result.attempt??result;
 const actual=(await pool.query('SELECT * FROM harness_attempts WHERE id=$1',[a.id])).rows[0];
 expect(actual.task_bundle.inputs._server_execution.executionVersionId).not.toBe(input.bundle.inputs._server_execution.executionVersionId);
 const authority=createTransportAuthority({pool});let calls=0;
 await authority('prepare',{attempt:actual,target:{machine:input.machineId},bundle:{inputs:{_server_execution:{fake:true}}}},async trusted=>{calls++;expect(trusted.bundle).toEqual(actual.task_bundle);});
 await revokeGrant({pool,grantId:actual.task_bundle.inputs._server_execution.grantId});
 await expect(authority('start',{attempt:actual,target:{machine:input.machineId}},()=>{calls++;})).rejects.toThrow('execution_grant_denied');
 await authority('cancel',{attempt:actual,target:{machine:input.machineId}},async(_,n)=>expect(n.endpoints.worker).toBe('http://m1:5231'));
 expect(calls).toBe(1);
});
it('脚本预约没有显式profile授权即拒绝，外来版本字段不能制造许可',async()=>{
 const taskId=randomUUID();await pool.query("INSERT INTO tasks(id,status) VALUES($1,'queued')",[taskId]);
 const store=createScriptReservationStore(pool,{executionDirectory:true});
 await expect(store.reserve({taskId,machineId:'xian-mac-m1',ownerKey:`script-${taskId}-a1`,configDigest:'a'.repeat(64),capacitySnapshot:capacitySnapshot(),profileId:'unknown',executionVersionId:randomUUID()})).rejects.toThrow('execution_grant_denied');
});
