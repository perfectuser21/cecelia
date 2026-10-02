import {createRequire} from 'node:module';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createBaselineEvidenceClient} from '../../execution-directory/baseline-evidence.js';
import {completeReport} from '../helpers/fleet-health-fixture.js';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import {DB_DEFAULTS} from '../../db-config.js';
import {directory,hashConfig} from '../../execution-directory/directory.js';
import {importLegacyPolicy,revokeGrant,resolveCleanup} from '../../execution-directory/store.js';
import {LEGACY_BINDINGS} from '../../execution-directory/legacy-policy.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
const database=process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname.slice(1):DB_DEFAULTS.database;
if(!/_(scratch|test)$/.test(database))throw Error('scratch/test database required');
const schema=`execution_baseline_${process.pid}_${randomUUID().replaceAll('-','')}`;
const admin=new pg.Client(options);const pool=new pg.Pool({...options,max:8,options:`-c search_path=${schema},public`});
const env={EXECUTOR_BRIDGE_URL:'http://mmv:3456',XIAN_CODEX_BRIDGE_URL:'http://m4:3456',FLEET_WORKER_US_MAC_M4_URL:'http://mmv:5231',FLEET_WORKER_XIAN_MAC_M1_URL:'http://m1:5231',FLEET_WORKER_XIAN_MAC_M4_URL:'http://m4:5231'};
const request=()=>({snapshotVersion:directory.current().version,machineId:'us-mac-m4',surface:'harness',provider:'codex',account:'team1',repo:'perfectuser21/cecelia'});
beforeAll(async()=>{await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,name TEXT,status TEXT,metadata JSONB DEFAULT '{}');CREATE TABLE tasks(id UUID PRIMARY KEY,status TEXT,result JSONB,payload JSONB);CREATE TABLE initiative_runs(id UUID PRIMARY KEY,phase TEXT DEFAULT 'planning',map_recovery_contract_id UUID,orchestrator_version TEXT DEFAULT 'v2');CREATE TABLE map_recovery_consumptions(contract_id UUID,attempt_id UUID);CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ);`);
 for(const [,id,name]of LEGACY_BINDINGS)await pool.query("INSERT INTO system_registry(id,type,name,status) VALUES($1,'machine',$2,'active')",[id,name]);
 for(const name of ['357_harness_provider_attempts','362_kernel_attempt_telemetry_reconcile','363_kernel_fleet_execution_receipts','364_kernel_local_container_naming','425_harness_attempt_cleanup_outbox','501_capacity_reservations'])await pool.query(readFileSync(new URL(`../../../migrations/${name}.sql`,import.meta.url),'utf8'));
 await pool.query(readFileSync(new URL('../../../migrations/503_execution_directory.sql',import.meta.url),'utf8'));
 await pool.query('ALTER TABLE harness_attempts ADD COLUMN failure_class TEXT');
 await importLegacyPolicy({pool,env});await directory.refresh({pool});
});
beforeEach(async()=>directory.refresh({pool}));
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});

const taskId='4378fb7f-e2a6-4148-acd6-664366933125',bootId=randomUUID(),configDigest='c'.repeat(64);
let activityRevision=0;const fixtureClient={maintenance:async()=>({boot_id:bootId,config_digest:configDigest,activity_revision:activityRevision}),health:async()=>({os:{version:"26.6.2"}}),proof:async()=>({activity_revision_before:activityRevision,activity_revision_after:activityRevision+=4,container_id:'a'.repeat(64),cleanup:{confirmed:true,absent:true}})};
async function input(){const n=directory.current().nodes.find(n=>n.canonical_id==='xian-mac-m4');return {expected_current_version_id:n.id,expected_config_hash:n.config_hash,expected_worker_boot_id:bootId,expected_worker_config_digest:configDigest,supported_os_floor:'26.6.2'};}
it('真实PG仅追加旧Mac OS版本，全部grant状态expiryscope精确保持并留事务任务证据',async()=>{
 const {createBaselineVersionStore}=await import('../../execution-directory/baseline-version.js');
 await pool.query("INSERT INTO tasks(id,status,result,payload) VALUES($1,'in_progress','{}','{}')",[taskId]);
 const old=(await input()).expected_current_version_id;const grants=(await pool.query('SELECT * FROM execution_grants WHERE node_version_id=$1 ORDER BY id',[old])).rows;
 await pool.query("UPDATE execution_grants SET state='revoked' WHERE id=$1",[grants[0].id]);await pool.query("UPDATE execution_grants SET expires_at='2000-01-01' WHERE id=$1",[grants[1].id]);
 await directory.refresh({pool});
 const store=createBaselineVersionStore({pool,client:fixtureClient,checkHealth:()=>true});const result=await store.publish('xian-mac-m4',await input());
 expect(result.new_version_id).not.toBe(old);const node=directory.current().nodes.find(n=>n.canonical_id==='xian-mac-m4');expect(node.profile.version_policy.os).toBe('26.6.2');expect(node.revision).toBe('2');
 const actual=(await pool.query('SELECT * FROM execution_grants WHERE node_version_id=$1',[node.id])).rows;
 for(const mapping of result.grant_lineage){const source=(await pool.query('SELECT * FROM execution_grants WHERE id=$1',[mapping.source_id])).rows[0],target=actual.find(g=>g.id===mapping.clone_id);for(const key of ['surface','provider','account_id','repo_scope','profile_id','state','expires_at'])expect(target[key]).toEqual(source[key]);}
 expect((await pool.query('SELECT result FROM tasks WHERE id=$1',[taskId])).rows[0].result.execution_baseline_operations).toHaveLength(1);
 await revokeGrant({pool,grantId:grants[2].id});expect((await pool.query('SELECT state FROM execution_grants WHERE id=$1',[result.grant_lineage.find(m=>m.source_id===grants[2].id).clone_id])).rows[0].state).toBe('revoked');
});
it('过期CAS或客户端自报profile/grant失败零写，旧版本不可变保持',async()=>{
 const {createBaselineVersionStore}=await import('../../execution-directory/baseline-version.js'),store=createBaselineVersionStore({pool,client:fixtureClient,checkHealth:()=>true}),before=Number((await pool.query('SELECT count(*) FROM execution_node_versions')).rows[0].count);
 const body=await input();await expect(store.publish('xian-mac-m4',{...body,expected_current_version_id:randomUUID()})).rejects.toThrow('execution_baseline_stale');
 await expect(store.publish('xian-mac-m4',{...body,profile:{}})).rejects.toThrow('execution_baseline_request_invalid');
 expect(Number((await pool.query('SELECT count(*) FROM execution_node_versions')).rows[0].count)).toBe(before);
});
it('恢复旧profile使用前向补偿revision，后续撤销不会因旧指针回滚复活',async()=>{
 const {createBaselineVersionStore}=await import('../../execution-directory/baseline-version.js'),store=createBaselineVersionStore({pool,client:fixtureClient,checkHealth:()=>true});
 const restore=(await pool.query("SELECT v.id FROM execution_node_versions v JOIN execution_nodes n USING(machine_registry_id) WHERE n.canonical_id='xian-mac-m4' AND revision=1")).rows[0].id;
 const body=await input();delete body.supported_os_floor;body.restore_version_id=restore;
 const current=body.expected_current_version_id,result=await store.compensate('xian-mac-m4',body);expect(result.mode).toBe('forward_compensation');expect(result.new_version_id).not.toBe(restore);expect(result.old_version_id).toBe(current);
 const n=directory.current().nodes.find(n=>n.canonical_id==='xian-mac-m4');expect(n.profile.version_policy.os).toBe('15.6.1');expect(n.grants.filter(g=>g.state==='revoked')).toHaveLength(2);
});
it('真实PG同机publisher持锁时，旧grant ID等待撤销仍在clone之后撤销同家族；无关grant不受影响',async()=>{
 const {createBaselineVersionStore}=await import('../../execution-directory/baseline-version.js');let entered,release;const start=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
 const before=await input();before.supported_os_floor='26.6.3';const source=(await pool.query("SELECT g.* FROM execution_grants g WHERE node_version_id=$1 AND state='active' AND expires_at IS NULL ORDER BY id LIMIT 1",[before.expected_current_version_id])).rows[0];
 const client={...fixtureClient,health:async()=>({os:{version:before.supported_os_floor}}),proof:async()=>{entered();await hold;return fixtureClient.proof();}},store=createBaselineVersionStore({pool,client,checkHealth:()=>true});
 const publishing=store.publish('xian-mac-m4',before);publishing.catch(()=>{});await start;let revoked=false;const revoking=revokeGrant({pool,grantId:source.id}).then(()=>{revoked=true;});
 await new Promise(r=>setTimeout(r,25));expect(revoked).toBe(false);release();const result=await publishing;await revoking;
 const mapped=result.grant_lineage.find(m=>m.source_id===source.id);expect((await pool.query('SELECT state FROM execution_grants WHERE id=$1',[mapped.clone_id])).rows[0].state).toBe('revoked');
 const other=result.grant_lineage.find(m=>m.root_id!==mapped.root_id);expect((await pool.query('SELECT state FROM execution_grants WHERE id=$1',[other.clone_id])).rows[0].state).toEqual((await pool.query('SELECT state FROM execution_grants WHERE id=$1',[other.source_id])).rows[0].state);
});
it('未释放真实script预约阻止基线登记，proof失败/boot变化均整事务零新版本',async()=>{
 const {createBaselineVersionStore}=await import('../../execution-directory/baseline-version.js');const old=await input();old.supported_os_floor='26.6.4';const count=()=>pool.query('SELECT count(*) AS count FROM execution_node_versions');const prior=(await count()).rows[0].count;
 const reservation=randomUUID();await pool.query(`INSERT INTO capacity_reservations(id,machine_id,owner_kind,owner_key,task_id,config_digest,allocation_mode,policy_version,snapshot_time,snapshot_digest) VALUES($1,'xian-mac-m4','script',$2,$3,$4,'exclusive_unclassified','v1',now(),$4)`,[reservation,`script-${taskId}-a1`,taskId,'b'.repeat(64)]);
 const store=createBaselineVersionStore({pool,client:fixtureClient,checkHealth:()=>true});await expect(store.publish('xian-mac-m4',old)).rejects.toThrow('execution_baseline_busy');
 // 按真实约束确认清理后释放，不能删除预约。
 await pool.query("UPDATE capacity_reservations SET status='released',released_at=now(),confirmed_receipt='{}' WHERE id=$1",[reservation]);
 const unhealthy={...fixtureClient,health:async()=>({os:{version:'26.6.4'}}),proof:async()=>{throw Error('execution_baseline_worker_unconfirmed');}};
 await expect(createBaselineVersionStore({pool,client:unhealthy,checkHealth:()=>true}).publish('xian-mac-m4',old)).rejects.toThrow('execution_baseline_worker_unconfirmed');
 const changed={...unhealthy,maintenance:async()=>({boot_id:randomUUID(),config_digest:configDigest})};await expect(createBaselineVersionStore({pool,client:changed,checkHealth:()=>true}).publish('xian-mac-m4',old)).rejects.toThrow('execution_baseline_worker_changed');expect((await count()).rows[0].count).toBe(prior);
});

it('真实PG+HTTP+HMAC默认publisher消费固定owned proof，generic任务result无激活路径',async()=>{
 const require=createRequire(import.meta.url),{createFleetWorkerServer}=require('../../../scripts/fleet-worker/fleet-worker.cjs'),{createLocalLaunchAdmission}=require('../../../scripts/fleet-worker/local-resource-admission.cjs'),{createBaselineProbe}=require('../../../scripts/fleet-worker/baseline-probe.cjs');
 const {createBaselineVersionStore}=await import('../../execution-directory/baseline-version.js'),root=fs.mkdtempSync(path.join(os.tmpdir(),'baseline-http-pg-')),gate=createLocalLaunchAdmission({lstat:()=>({})}),token='real-http-pg-baseline-key-'.repeat(3),image='sha256:aeaf290525a623a2182fdce5376ca914e9de2d0b1bab0ba18d7d07b9ea379033';let container=null,owner,workspace;
 const runCommand=async(file,args)=>{if(file==='sw_vers')return {stdout:'26.6.4'};if(file==='git'){if(args[1]==='add'){workspace=args[4];fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'.git'),'owned');}if(args[1]==='remove'){fs.rmSync(workspace,{recursive:true,force:true});workspace=null;}return {stdout:workspace?`worktree ${workspace}\n`:''};}
  if(args[0]==='image')return {stdout:JSON.stringify([{Id:image}])};if(args[0]==='create'){owner=args.find(s=>s.startsWith('cecelia.baseline.owner=')).split('=')[1];container={Id:'d'.repeat(64),Image:image,Config:{Labels:{'cecelia.baseline.owner':owner}},State:{Running:false,ExitCode:0},HostConfig:{NanoCpus:500000000,Memory:134217728,MemorySwap:134217728,PidsLimit:64,NetworkMode:'none',ReadonlyRootfs:true},Mounts:[{Type:'bind',RW:false,Source:workspace,Destination:'/workspace'}]};return {stdout:container.Id};}
  if(args[0]==='inspect'){if(!container)throw Object.assign(Error('absent'),{stderr:'No such container'});return {stdout:JSON.stringify([container])};}if(args[0]==='start')return {stdout:JSON.stringify({node:'v25.8.0',git:'git version 2.39.5',codex:'codex-cli 0.147.0',workspace:true,sandbox:true})};if(args[0]==='rm'){container=null;return {stdout:''};}throw Error('unexpected command');};
 const probe=createBaselineProbe({root,workspaceBase:path.join(root,'shared'),gate,machineId:'xian-mac-m4',repoRoot:'/fixture/protected-repo',getConfigDigest:()=>configDigest,runCommand});
 const server=createFleetWorkerServer({machineId:'xian-mac-m4',attemptToken:token,launchAdmission:gate,runtimeConfigDigest:configDigest,baselineProbe:probe,healthCacheTtlMs:0,probeHealth:()=>completeReport(directory.current().nodes.find(n=>n.canonical_id==='xian-mac-m4').profile,{os:{version:'26.6.4'},drain:{active:true}}),attemptRunner:{prepare(){},start(){},inspect(){},cancel(){},terminal(){},async reconcile(){},maintenance:()=>({pending:0})},scriptRunner:{maintenance:()=>({pending:0})},orchestratorRunner:{maintenance:()=>({preparing:0,prepared:0,running_processes:0})}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const client=createBaselineEvidenceClient({token,fetchFn:(url,options)=>fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`,options)}),body=await input();body.expected_worker_boot_id=gate.snapshot().boot_id;body.supported_os_floor='26.6.4';
  const result=await createBaselineVersionStore({pool,client}).publish('xian-mac-m4',body);expect(result.committed).toBe(true);expect(result.proof).toMatchObject({schema_version:'fleet-baseline-proof/v1',image_id:image,os_version:'26.6.4',workspace_cleanup:{confirmed:true,absent:true},cleanup:{confirmed:true,absent:true}});expect(container).toBe(null);expect(workspace).toBe(null);expect(gate.snapshot().maintenance_pending).toBe(0);expect(result.execution_ready).toBe(false);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
});

it('真实PG后写超过总deadline必回滚版本与任务事件，不能晚COMMIT自称成功',async()=>{
 const {createBaselineVersionStore}=await import('../../execution-directory/baseline-version.js');const old=await input();old.supported_os_floor='26.6.5';
 const prior=(await pool.query('SELECT count(*) FROM execution_node_versions')).rows[0].count;
 const events=(await pool.query('SELECT result FROM tasks WHERE id=$1',[taskId])).rows[0].result.execution_baseline_operations.length;
 let clock=Date.now();const mocked=vi.spyOn(Date,'now').mockImplementation(()=>clock);
 const boundedPool={query:(...args)=>pool.query(...args),async connect(){const real=await pool.connect();return {release:()=>real.release(),async query(...args){const result=await real.query(...args);if(String(args[0]?.text??args[0]).includes('INSERT INTO execution_node_versions'))clock+=36000;return result;}};}};
 const client={...fixtureClient,health:async()=>({os:{version:'26.6.5'}})};
 try{await expect(createBaselineVersionStore({pool:boundedPool,client,checkHealth:()=>true}).publish('xian-mac-m4',old)).rejects.toThrow('execution_baseline_deadline');}
 finally{mocked.mockRestore();}
 expect((await pool.query('SELECT count(*) FROM execution_node_versions')).rows[0].count).toBe(prior);
 expect((await pool.query('SELECT result FROM tasks WHERE id=$1',[taskId])).rows[0].result.execution_baseline_operations).toHaveLength(events);
 await directory.refresh({pool});expect((await input()).expected_current_version_id).toBe(old.expected_current_version_id);
});

it('真实PG晚COMMIT确认与丢失确认诚实返回需对账，不能声称失败零写或已正常激活',async()=>{
 const {createBaselineVersionStore}=await import('../../execution-directory/baseline-version.js');
 for(const mode of ['late','lost']){
  const body=await input();body.supported_os_floor=mode==='late'?'26.6.6':'26.6.7';let clock=Date.now();const mocked=vi.spyOn(Date,'now').mockImplementation(()=>clock);
  const ambiguousPool={query:(...args)=>pool.query(...args),async connect(){const real=await pool.connect();return {release:destroy=>real.release(destroy),async query(...args){const result=await real.query(...args);if((args[0]?.text??args[0])==='COMMIT'){if(mode==='lost')throw Error('lost commit acknowledgement');clock+=36000;}return result;}};}};
  let result;try{result=await createBaselineVersionStore({pool:ambiguousPool,client:{...fixtureClient,health:async()=>({os:{version:body.supported_os_floor}})},checkHealth:()=>true}).publish('xian-mac-m4',body);}finally{mocked.mockRestore();}
  expect(result).toMatchObject({committed:mode==='late'?true:null,commit_outcome:mode==='late'?'confirmed_late':'unknown',requires_reconciliation:true,directory_refresh_confirmed:false,execution_ready:false});
  const actual=(await pool.query('SELECT current_version_id FROM execution_nodes WHERE canonical_id=$1',['xian-mac-m4'])).rows[0];expect(actual.current_version_id).toBe(result.new_version_id);await directory.refresh({pool});
 }
});

it('新Mac revision真实预约持久化版本与grant绑定，cleanup只接受持久身份',async()=>{
 const {createAttemptStore}=await import('../../orchestrator/attempt-store.js');
 const node=directory.current().nodes.find(n=>n.canonical_id==='xian-mac-m4');
 const grant=(await pool.query("SELECT * FROM execution_grants WHERE node_version_id=$1 AND surface='harness' AND provider='codex' AND state='active' AND (expires_at IS NULL OR expires_at>now()) LIMIT 1",[node.id])).rows[0];expect(grant).toBeTruthy();
 const runId=randomUUID();await pool.query('INSERT INTO initiative_runs(id) VALUES($1)',[runId]);
 const input={id:randomUUID(),runId,hop:1,phase:'planning',role:'reporter',provider:'codex',accountId:grant.account_id,machineId:'xian-mac-m4',callbackSecretHash:'a'.repeat(64),capacitySnapshot:{verified:true,machine:'xian-mac-m4',expires_at:Date.now()+60000,capacity:{ok:true,available:8,physical_base_slots:8,effective_base_slots:8}},bundle:{inputs:{execution_surface:'fleet-worker',workspace_spec:{repo:'perfectuser21/cecelia'}}}};
 const result=await createAttemptStore(pool,{executionDirectory:true}).createAttempt(input),attempt=result.attempt??result;
 const persisted=(await pool.query('SELECT * FROM harness_attempts WHERE id=$1',[attempt.id])).rows[0];
 expect(persisted.task_bundle.inputs._server_execution).toEqual({executionVersionId:node.id,grantId:grant.id});
 expect((await resolveCleanup(pool,{executionVersionId:node.id,persistedAttemptIdentity:persisted})).id).toBe(node.id);
 await expect(resolveCleanup(pool,{executionVersionId:node.id,persistedAttemptIdentity:{machine_id:'xian-mac-m4',provider:'codex',account_id:grant.account_id}})).rejects.toThrow('execution_cleanup_identity_mismatch');
});
