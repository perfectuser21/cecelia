import {assertLinuxPoolAuthority} from '../../linux-pool/task-authority.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import pg from 'pg';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {DB_DEFAULTS} from '../../db-config.js';
import {fixture} from '../../linux-pool/__tests__/runtime-receipt-fixture.js';
import {createLinuxRuntimeAuthorization} from '../../linux-pool/runtime-service.js';
import {createOnboardingRecovery} from '../../linux-pool/onboarding-recovery.js';
import {createLinuxOnboardingStep} from '../../linux-pool/onboarding-step.js';
import {directory} from '../../execution-directory/directory.js';
import {authorize,resolveCleanup} from '../../execution-directory/store.js';
import {routeWork} from '../../work-router.js';
import {createScriptReservationStore} from '../../orchestrator/script-reservation-store.js';
import {createLinuxRuntimeAdmission} from '../../linux-pool/runtime-admission.js';
import {normalizeRuntimeDeployment} from '../../linux-pool/runtime-deployment.js';
import runtimeModule from '../../../scripts/fleet-worker/linux-script-runtime.cjs';
import bridgeModule from '../../../scripts/fleet-worker/linux-script-bridge.cjs';
import workerModule from '../../../scripts/fleet-worker/linux-pool-server.cjs';
import dockerFixture from '../../../scripts/fleet-worker/linux-script-test-fixture.cjs';
import {createScriptWorkerClient} from '../../script-worker-client.js';
import {createLinuxScriptAuthorization} from '../../linux-pool/script-authority.js';
import {usesManagedScript,prepareManagedScript,reapManagedScripts} from '../../script-managed-executor.js';
import {validateScriptPayload} from '../../lib/script-task-spec.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
const database=process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname.slice(1):DB_DEFAULTS.database;
if(!/_(scratch|test)$/.test(database))throw Error('scratch/test database required');
const schema=`linux_script_${process.pid}_${randomUUID().replaceAll('-','')}`,admin=new pg.Client(options),pool=new pg.Pool({...options,max:8,options:`-c search_path=${schema},public`});
let f,machine,service,created=[];
const createTask=async (args,internal)=>{expect(assertLinuxPoolAuthority({...args,requested_task_type:args.task_type,task:args},internal)).toBe(true);routeWork({...args,requested_task_type:args.task_type,task:args},[],internal);created.push(args);const task=(await args.db.query("INSERT INTO tasks(id,status,parent_task_id,payload) VALUES($1,$2,$3,$4) RETURNING *",[randomUUID(),args.status,args.parent_task_id,args.payload])).rows[0];return {success:true,task};};
function signed(prepared,mutate=()=>{}){
 const r=structuredClone(f.receipt);r.nonce=prepared.nonce;r.execution_version_id=prepared.execution_version_id;
 const i=r.cases[0].identity;i.execution_version_id=prepared.execution_version_id;i.execution_grant_id=prepared.grant_ids.safe;
 // 复用严格单元夹具，只替换本事务生成的授权身份。
 const old=f.receipt.nonce;const replace=v=>JSON.parse(JSON.stringify(v).replaceAll(old,prepared.nonce));
 const copy=replace(r);copy.cases[0].proof.identity={...copy.cases[0].identity};copy.cases[0].cleanup={...copy.cases[0].cleanup,...copy.cases[0].identity};
 const digest=v=>import('node:crypto').then(({createHash})=>createHash('sha256').update(JSON.stringify(v)).digest('hex'));
 return digest({job:{profile:'safe',cmd:`printf '%s\\n' '${prepared.nonce}:safe'; sleep 8`,timeout_sec:20,env:{}},profile_digest:copy.cases[0].profile_digest}).then(h=>{
  copy.cases[0].identity.config_digest=h;copy.cases[0].proof.identity.config_digest=h;copy.cases[0].cleanup.config_digest=h;mutate(copy);
  return {receipt:copy,signature:createHmac('sha256',f.deployment.key).update(JSON.stringify(copy)).digest('hex')};});
}
beforeAll(async()=>{await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);await pool.query(`CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,name TEXT,status TEXT,metadata JSONB DEFAULT '{}');
 CREATE TABLE tasks(id UUID PRIMARY KEY,status TEXT,parent_task_id UUID,payload JSONB,result JSONB,claimed_by TEXT,claimed_at TIMESTAMPTZ,started_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,completed_at TIMESTAMPTZ);
 CREATE TABLE harness_attempts(id UUID PRIMARY KEY,status TEXT,actual_machine_id TEXT,requested_machine_id TEXT,machine_id TEXT);
 CREATE TABLE harness_attempt_cleanup_outbox(attempt_id UUID,status TEXT,target_machine_id TEXT);
 CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ);`);
 for(const file of ['501_capacity_reservations.sql','503_execution_directory.sql','505_linux_pool_authorization.sql','507_linux_script_authorization.sql'])await pool.query(readFileSync(new URL('../../../migrations/'+file,import.meta.url),'utf8'));
});
beforeEach(async()=>{
 f=fixture();machine=randomUUID();f.deployment.expected.machine_registry_id=machine;f.deployment.authority.expected.machine_registry_id=machine;f.deployment.pool.machine_registry_id=machine;
 f.receipt.machine_registry_id=machine;f.receipt.cases[0].proof.machine_registry_id=machine;f.deployment.machine_id='linux-'+machine;f.receipt.machine_id=f.deployment.machine_id;
 f.deployment.pool.machine_id=f.deployment.machine_id;
 const d=f.deployment;f.deployment=normalizeRuntimeDeployment({pool:d.pool,revision:d.expected.revision,host_boot_id:d.expected.host_boot_id,worker_boot_id:d.expected.worker_boot_id,daemon_id:d.expected.daemon_id,
  profiles:d.profiles,worker_credential_file:d.authority.worker_credential.file,execution_credential_file:d.authority.execution_credential.file,parent_task_id:d.parent_task_id},d.workerToken,d.key);
 f.receipt.pool_config_digest=f.deployment.expected.pool_config_digest;f.receipt.cases[0].proof.config_digest=f.deployment.expected.pool_config_digest;
 for(const i of [f.receipt.cases[0].identity,f.receipt.cases[0].proof.identity,f.receipt.cases[0].cleanup]){i.machine_id=f.deployment.machine_id;i.worker_id=f.deployment.machine_id;}
 created=[];service=createLinuxRuntimeAuthorization({pool,readDeployment:async()=>f.deployment,createTask,afterTerminal:async()=>{}});
 await pool.query("INSERT INTO system_registry(id,type,name,status,metadata) VALUES($1,'machine',$2,'active','{\"role\":\"worker\"}')",[machine,f.deployment.machine_id]);
 await pool.query("INSERT INTO tasks(id,status) VALUES($1,'in_progress')",[f.deployment.parent_task_id]);
});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});
it('prepare自动子任务及pending同代许可；验签完成事实证据actor后才原子激活',async()=>{
 const p=await service.prepare(machine,{expected_version_id:null});expect(p.execution).toBe(false);expect(created).toHaveLength(1);expect(created[0].parent_task_id).toBe(f.deployment.parent_task_id);expect(created[0].executor_kind).toBe('linux-pool-controller');
 expect(createHash('sha256').update(JSON.stringify(p.runtime_configuration.profiles.safe.profile)).digest('hex')).toBe(f.deployment.authority.profiles.safe);
 expect((await pool.query('SELECT state FROM execution_node_versions WHERE id=$1',[p.execution_version_id])).rows[0].state).toBe('pending');
 await expect(pool.query("UPDATE execution_node_versions SET state='active' WHERE id=$1",[p.execution_version_id])).rejects.toThrow('execution_attested_activation_not_enabled');
 const envelope=await signed(p),result=await service.activate(machine,{runtime_id:p.id,expected_version_id:null,envelope});expect(result.execution).toBe(true);
 const task=(await pool.query('SELECT * FROM tasks WHERE id=$1',[p.evidence_task_id])).rows[0];expect(task.status).toBe('completed');expect(task.result).toMatchObject({actor:'linux-script-canary:'+machine,fact:expect.any(String),evidence:{signature:envelope.signature}});
 expect((await pool.query('SELECT status FROM tasks WHERE id=$1',[f.deployment.parent_task_id])).rows[0].status).toBe('in_progress');
 await directory.refresh({pool});expect((await authorize(pool,{snapshotVersion:directory.current().version,machineId:f.deployment.machine_id,surface:'managed_script',provider:'script',profileId:'safe'})).executionVersionId).toBe(p.execution_version_id);
 expect(await service.activate(machine,{runtime_id:p.id,expected_version_id:null,envelope})).toEqual(result);
});
it('prepare重试复用pending意图及子任务，错签名/输出不消费且不完成任务',async()=>{
 const p=await service.prepare(machine,{expected_version_id:null});expect((await service.prepare(machine,{expected_version_id:null})).id).toBe(p.id);expect(created).toHaveLength(1);
 await expect(service.activate(machine,{runtime_id:p.id,expected_version_id:null,envelope:await signed(p,r=>r.cases[0].terminal.stdout='bad')})).rejects.toThrow('linux_pool_runtime_receipt_invalid');
 expect((await pool.query('SELECT state,receipt FROM linux_script_authorizations WHERE id=$1',[p.id])).rows[0]).toEqual({state:'prepared',receipt:null});
 expect((await pool.query('SELECT status FROM tasks WHERE id=$1',[p.evidence_task_id])).rows[0].status).toBe('in_progress');
});
it('并发激活仅同一版本，撤销不依赖部署凭据且旧身份仍能清理',async()=>{
 const p=await service.prepare(machine,{expected_version_id:null}),body={runtime_id:p.id,expected_version_id:null,envelope:await signed(p)};
 await Promise.all([service.activate(machine,body),service.activate(machine,body)]);
 const offline=createLinuxRuntimeAuthorization({pool,readDeployment:async()=>{throw Error('missing');}});
 await offline.revoke(machine,{runtime_id:p.id,expected_version_id:p.execution_version_id});
 await expect(service.activate(machine,body)).rejects.toThrow();
 expect((await resolveCleanup(pool,{executionVersionId:p.execution_version_id,persistedAttemptIdentity:{machine_id:f.deployment.machine_id,execution_version_id:p.execution_version_id}})).id).toBe(p.execution_version_id);
 await expect(pool.query("UPDATE execution_grants SET state='active' WHERE node_version_id=$1",[p.execution_version_id])).rejects.toThrow();
});
it('到期、配置换代、机器scheduler/US和请求注入均不能签发或激活',async()=>{
 await expect(service.prepare(machine,{expected_version_id:null,profile:{}})).rejects.toThrow('linux_pool_request_invalid');
 const p=await service.prepare(machine,{expected_version_id:null});await pool.query("UPDATE linux_script_authorizations SET challenge_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[p.id]);
 await expect(service.activate(machine,{runtime_id:p.id,expected_version_id:null,envelope:await signed(p)})).rejects.toThrow('linux_pool_runtime_unavailable');
 await pool.query("UPDATE system_registry SET metadata='{\"role\":\"scheduler\"}' WHERE id=$1",[machine]);await expect(service.prepare(machine,{expected_version_id:null})).rejects.toThrow('linux_pool_machine_forbidden');
 await expect(service.prepare('1a379d80-ad36-47d3-88ba-e545ab299a54',{expected_version_id:null})).rejects.toThrow('linux_pool_machine_forbidden');
});
it('过期验收只在完整签名清理确认后撤销并归档旧子任务，再准备全新代；未知不换nonce',async()=>{
 const p=await service.prepare(machine,{expected_version_id:null}),state={runtime_json:JSON.stringify(p),expected_version_id:null};
 const recover=createOnboardingRecovery({pool,runtimeAuthorization:service,readRuntime:async()=>f.deployment,afterTerminal:async()=>{}});
 const envelope=await signed(p);expect(await recover('script',machine,state,envelope)).toBe(false);
 await pool.query("UPDATE linux_script_authorizations SET challenge_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[p.id]);
 await expect(recover('script',machine,state,await signed(p,r=>r.cases[0].cleanup.absent=false))).rejects.toThrow('linux_pool_runtime_receipt_invalid');
 expect((await pool.query('SELECT state FROM linux_script_authorizations WHERE id=$1',[p.id])).rows[0].state).toBe('prepared');
 expect(await recover('script',machine,state,envelope)).toBe(true);expect(await recover('script',machine,state,envelope)).toBe(true);
 expect((await pool.query('SELECT state FROM linux_script_authorizations WHERE id=$1',[p.id])).rows[0].state).toBe('revoked');
 expect((await pool.query('SELECT status,result FROM tasks WHERE id=$1',[p.evidence_task_id])).rows[0]).toMatchObject({status:'archived',result:{actor:'linux-pool-onboarding',evidence:{signature:envelope.signature}}});
 const next=await service.prepare(machine,{expected_version_id:null});expect(next.nonce).not.toBe(p.nonce);expect(next.execution_version_id).not.toBe(p.execution_version_id);
});
it('显式撤销prepared后过期不得被内部恢复重新prepare，撤销在途续验也持久阻断',async()=>{
 const p=await service.prepare(machine,{expected_version_id:null}),envelope=await signed(p),state={runtime_json:JSON.stringify(p),expected_version_id:null};
 const flowId=randomUUID();await pool.query("INSERT INTO tasks(id,status,payload) VALUES($1,'in_progress',$2)",[flowId,{linux_onboarding:{machine_registry_id:machine,phase:'renew_wait'}}]);
 await service.revoke(machine,{runtime_id:p.id,expected_version_id:null});await pool.query("UPDATE linux_script_authorizations SET challenge_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[p.id]);
 const recover=createOnboardingRecovery({pool,runtimeAuthorization:service,readRuntime:async()=>f.deployment,afterTerminal:async()=>{}});
 await expect(recover('script',machine,state,envelope)).rejects.toThrow('linux_pool_explicitly_revoked');
 expect((await pool.query('SELECT payload FROM tasks WHERE id=$1',[flowId])).rows[0].payload.linux_onboarding.revoked).toBe(true);
});
it('active已提交但阶段回执丢失跨24小时后，按实际current version进入内部续验且不误用旧CAS',async()=>{
 const p=await service.prepare(machine,{expected_version_id:null}),envelope=await signed(p);await service.activate(machine,{runtime_id:p.id,expected_version_id:null,envelope});
 await pool.query("UPDATE linux_script_authorizations SET authorization_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[p.id]);
 let state={phase:'script_activate',runtime_json:JSON.stringify(p),script_envelope_json:JSON.stringify(envelope),expected_version_id:null};
 const recover=createOnboardingRecovery({pool,runtimeAuthorization:service,readRuntime:async()=>f.deployment,afterTerminal:async()=>{}});
 const step=createLinuxOnboardingStep({pool,runtimeAuthorization:service,recover});
 const original=structuredClone(state);
 await step({id:f.deployment.parent_task_id},{id:machine,name:f.deployment.machine_id,metadata:{onboarding:{request:{}}}},state,async s=>{state=s;});
 expect(state).toMatchObject({phase:'renew_wait',expected_version_id:p.execution_version_id});
 expect(await recover('script',machine,original,envelope)).toMatchObject({phase:'renew_wait',expected_version_id:p.execution_version_id});
 expect((await pool.query('SELECT state FROM linux_script_authorizations WHERE id=$1',[p.id])).rows[0].state).toBe('revoked');
});
it('启动失败但精确清理已签名确认时仅归档旧canary并重读安装身份，不能直接激活',async()=>{
 const p=await service.prepare(machine,{expected_version_id:null}),r=(await signed(p)).receipt;r.schema_version='linux-script-canary-cleanup/v1';delete r.script_adapter_verified;
 r.cases=r.cases.map(({proof,terminal,...c})=>({...c,not_started:false}));const envelope={receipt:r,signature:createHmac('sha256',f.deployment.key).update(JSON.stringify(r)).digest('hex')};
 await expect(service.activate(machine,{runtime_id:p.id,expected_version_id:null,envelope})).rejects.toThrow('linux_pool_runtime_receipt_invalid');
 const recover=createOnboardingRecovery({pool,runtimeAuthorization:service,readRuntime:async()=>f.deployment,afterTerminal:async()=>{}});
 expect(await recover('script',machine,{runtime_json:JSON.stringify(p),expected_version_id:null},envelope)).toEqual({phase:'renew_wait',expected_version_id:null});
 expect((await pool.query('SELECT status FROM tasks WHERE id=$1',[p.evidence_task_id])).rows[0].status).toBe('archived');
 expect((await pool.query('SELECT state FROM execution_grants WHERE node_version_id=$1',[p.execution_version_id])).rows.every(g=>g.state==='revoked')).toBe(true);
});
it('激活中途失败回滚task完成/证据/目录/grants；授权历史及过期不可扩张',async()=>{
 const p=await service.prepare(machine,{expected_version_id:null});await pool.query(`CREATE FUNCTION reject_script_active() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='active' THEN RAISE EXCEPTION 'fixture_failure';END IF;RETURN NEW;END $$;CREATE TRIGGER reject_script_active BEFORE UPDATE ON execution_grants FOR EACH ROW EXECUTE FUNCTION reject_script_active()`);
 try{await expect(service.activate(machine,{runtime_id:p.id,expected_version_id:null,envelope:await signed(p)})).rejects.toThrow('fixture_failure');}finally{await pool.query('DROP TRIGGER reject_script_active ON execution_grants;DROP FUNCTION reject_script_active()');}
 expect((await pool.query('SELECT status FROM tasks WHERE id=$1',[p.evidence_task_id])).rows[0].status).toBe('in_progress');
 expect((await pool.query('SELECT state,receipt FROM linux_script_authorizations WHERE id=$1',[p.id])).rows[0]).toEqual({state:'prepared',receipt:null});
 await expect(pool.query("UPDATE linux_script_authorizations SET nonce=$2 WHERE id=$1",[p.id,'f'.repeat(64)])).rejects.toThrow('linux_script_history_immutable');
 await expect(pool.query("UPDATE linux_script_authorizations SET authorization_expires_at=authorization_expires_at+interval '1 second' WHERE id=$1",[p.id])).rejects.toThrow('linux_script_history_immutable');
});
it('运行后切换scheduler立即禁止实际authorize；别的surface不能借验收证据激活',async()=>{
 const p=await service.prepare(machine,{expected_version_id:null});await service.activate(machine,{runtime_id:p.id,expected_version_id:null,envelope:await signed(p)});
 await expect(pool.query(`INSERT INTO execution_grants(node_version_id,surface,provider,profile_id,provenance,evidence_task_id,state,expires_at)
  VALUES($1,'harness','codex','safe','linux_script_canary',$2,'active',now()+interval '1 hour')`,[p.execution_version_id,p.evidence_task_id])).rejects.toThrow('execution_evidence_required');
 await pool.query("UPDATE system_registry SET metadata='{\"role\":\"scheduler_only\"}' WHERE id=$1",[machine]);let calls=0;
 await expect(authorize(pool,{snapshotVersion:directory.current().version,machineId:f.deployment.machine_id,surface:'managed_script',provider:'script',profileId:'safe'},()=>calls++)).rejects.toThrow('execution_version_stale');expect(calls).toBe(0);
});
it('等待机器锁时到期按DB时钟重验，不完成证据任务',async()=>{
 const p=await service.prepare(machine,{expected_version_id:null}),body={runtime_id:p.id,expected_version_id:null,envelope:await signed(p)};
 await pool.query("UPDATE linux_script_authorizations SET challenge_expires_at=clock_timestamp()+interval '80 milliseconds' WHERE id=$1",[p.id]);
 const db=await pool.connect();await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtextextended('harness_attempt_machine:'||$1,0))",[f.deployment.machine_id]);
 const rejected=expect(service.activate(machine,body)).rejects.toThrow('linux_pool_runtime_unavailable');await new Promise(r=>setTimeout(r,100));await db.query('COMMIT');db.release();await rejected;
 expect((await pool.query('SELECT status FROM tasks WHERE id=$1',[p.evidence_task_id])).rows[0].status).toBe('in_progress');
});
it('受信配置换代使旧nonce失效；新版本CAS冲突不完成旧子任务',async()=>{
 const p=await service.prepare(machine,{expected_version_id:null});f.deployment.policyDigest='f'.repeat(64);
 await expect(service.activate(machine,{runtime_id:p.id,expected_version_id:null,envelope:await signed(p)})).rejects.toThrow('linux_pool_deployment_changed');
 expect((await pool.query('SELECT status FROM tasks WHERE id=$1',[p.evidence_task_id])).rows[0].status).toBe('in_progress');
});
async function activePool(){const p=await service.prepare(machine,{expected_version_id:null});await service.activate(machine,{runtime_id:p.id,expected_version_id:null,envelope:await signed(p)});return p;}
async function scriptInput(){const taskId=randomUUID();await pool.query("INSERT INTO tasks(id,status) VALUES($1,'queued')",[taskId]);return {taskId,machineId:f.deployment.machine_id,ownerKey:`script-${taskId}-a1`,configDigest:'a'.repeat(64),profileId:'safe'};}
async function snapshot(){return createLinuxRuntimeAdmission({pool,readDeployment:async()=>f.deployment,readIdentity:async()=>({worker_boot_id:f.deployment.expected.worker_boot_id})})(f.deployment.machine_id,'safe');}
it('新Linux目录节点无需环境白名单，明确走managed且无profile不能回退宿主SSH',async()=>{
 await activePool();const host=f.deployment.machine_id,task={payload:{}},deps={env:{}};
 expect(validateScriptPayload({host,cmd:'printf ok',timeout_sec:20}).host).toBe(host);
 expect(usesManagedScript(task,{host},deps)).toBe(true);
 expect(await prepareManagedScript(task,{host,artifact_paths:[]},pool,deps)).toMatchObject({outcome:'blocked',reason:'script_managed_spec_required'});
});
it('两个Linux脚本并发只有一个独占预约，跨version/grant或过期快照零预约',async()=>{
 const p=await activePool(),store=createScriptReservationStore(pool,{executionDirectory:true}),input=await scriptInput(),s=await snapshot();
 for(const patch of [{execution_version_id:randomUUID()},{execution_grant_id:randomUUID()},{worker_boot_id:randomUUID()},{policy_digest:'f'.repeat(64)},{expires_at:0}]){
  expect(await store.reserve({...input,capacitySnapshot:{...s,...patch}})).toMatchObject({outcome:'wait'});
 }
 expect((await pool.query('SELECT id FROM capacity_reservations WHERE machine_id=$1',[f.deployment.machine_id])).rows).toHaveLength(0);
 const other=await scriptInput(),outcomes=await Promise.all([store.reserve({...input,capacitySnapshot:await snapshot()}),store.reserve({...other,capacitySnapshot:await snapshot()})]);
 expect(outcomes.filter(x=>x.outcome==='reserved')).toHaveLength(1);expect(outcomes.find(x=>x.outcome==='reserved').reservation.execution_version_id).toBe(p.execution_version_id);
});
it('预约事务即固定同代worker身份；迟到旧boot不能污染，重启清理无需当前capabilities',async()=>{
 await activePool();const store=createScriptReservationStore(pool,{executionDirectory:true}),input=await scriptInput();
 const {reservation:row}=await store.reserve({...input,capacitySnapshot:await snapshot()});
 expect(row.worker_id).toBe(f.deployment.machine_id);expect(row.worker_boot_id).toBe(f.deployment.expected.worker_boot_id);
 await expect(store.markLaunching(row.id,{worker_id:row.worker_id,worker_boot_id:randomUUID()})).rejects.toThrow('reservation_transition_rejected');
 expect((await pool.query('SELECT worker_boot_id,status FROM capacity_reservations WHERE id=$1',[row.id])).rows[0]).toEqual({worker_boot_id:f.deployment.expected.worker_boot_id,status:'reserved'});
 expect((await store.markLaunching(row.id,{worker_id:row.worker_id,worker_boot_id:row.worker_boot_id})).status).toBe('launching');
});
it('升级前空worker预约仅从持久版本补身份，崩溃reaper不读取当前能力',async()=>{
 const p=await activePool(),input=await scriptInput(),id=randomUUID(),store=createScriptReservationStore(pool,{executionDirectory:true});
 await pool.query(`INSERT INTO capacity_reservations(id,machine_id,owner_kind,owner_key,task_id,config_digest,allocation_mode,policy_version,snapshot_time,snapshot_digest,execution_version_id,execution_grant_id)
  VALUES($1,$2,'script',$3,$4,$5,'exclusive_unclassified','script-exclusive-v1',now(),$5,$6,$7)`,[id,input.machineId,input.ownerKey,input.taskId,input.configDigest,p.execution_version_id,p.grant_ids.safe]);
 await expect(store.markLaunching(id,{worker_id:input.machineId,worker_boot_id:randomUUID()})).rejects.toThrow('reservation_transition_rejected');
 await pool.query("UPDATE tasks SET status='cancelled' WHERE id=$1",[input.taskId]);let capabilities=0;
 const client={inspect:async()=>{throw Error('not started');},capabilities:async()=>{capabilities++;throw Error('new boot cannot fill history');},cancel:async(_machine,body)=>{expect(body.worker_boot_id).toBe(f.deployment.expected.worker_boot_id);return {authenticated:true,receipt:{...body,status:'cleaned',absent:true,tombstoned:true}};}};
 await reapManagedScripts(pool,{managed:{client}},async()=>{});expect(capabilities).toBe(0);
 expect((await pool.query('SELECT status,worker_boot_id FROM capacity_reservations WHERE id=$1',[id])).rows[0]).toEqual({status:'released',worker_boot_id:f.deployment.expected.worker_boot_id});
});
it.each(['success','resources','maintenance','unknown_create'])('真PG预约→HTTP→Unix→持久root adapter：%s仅精确回执能释放',async mode=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'linux-pg-')),socketPath=path.join(root,'bridge.sock'),docker=dockerFixture.fixture();
 let bridgeClient,bridge,runtime,command,logs;
 const proxy=Object.fromEntries(['start','inspect','cancel'].map(a=>[a,b=>bridgeClient[a](b)]));
 const worker=workerModule.createLinuxPoolServer({profile:f.deployment.pool,token:f.deployment.workerToken,revision:f.deployment.expected.revision,scriptBridge:proxy,readWorkerBootId:()=>f.deployment.expected.worker_boot_id});
 await new Promise(r=>worker.listen(0,'127.0.0.1',r));
 // 网络夹具仅把已登记endpoint定向到本机；身份/profile/双凭据/DB授权/协议链均实际校验。
 f.deployment.endpoint='http://127.0.0.1:'+worker.address().port;
 try{
  const prepared=await activePool();
  const run=async(c,args,opts)=>{
   const result=await docker.options.run(c,args,opts);
   if(args[0]==='create'){
    docker.container.Name='/'+args.find(v=>v.startsWith('--name=')).slice(7);docker.container.Config.Labels=Object.fromEntries(args.filter(v=>v.startsWith('--label=')).map(v=>v.slice(8).split(/=(.*)/s).slice(0,2)));command=args.at(-1);
    if(mode==='unknown_create')throw Error('lost create response');
   }
   if(args[0]==='start'){logs=await promisify(execFile)('/bin/sh',['-c',command]);docker.container.State.Status='exited';}
   if(args[0]==='logs')return logs;return result;
  };
  runtime=runtimeModule.createLinuxScriptRuntime({stateRoot:path.join(root,'state'),pathRoot:root,ownerUid:process.getuid(),platform:'linux',getuid:()=>0,key:f.deployment.key,
   deployment:prepared.runtime_configuration,assertCanLaunch:async()=>{if(mode==='resources')throw Error('script_local_resources_unavailable');if(mode==='maintenance')throw Error('worker_draining');},run});
  bridge=bridgeModule.createLinuxScriptBridge({key:f.deployment.key,runtime});await new Promise(r=>bridge.listen(socketPath,r));bridgeClient=bridgeModule.createLinuxScriptBridgeClient({socketPath});
  const client=createScriptWorkerClient({pool,linuxAuthorization:createLinuxScriptAuthorization({readProtected:file=>file===f.deployment.authority.worker_credential.file?f.deployment.workerToken:f.deployment.key})});
  const store=createScriptReservationStore(pool,{executionDirectory:true}),input=await scriptInput(),job={profile:'safe',cmd:'printf actual-linux-output',timeout_sec:20,env:{}};
  input.configDigest=createHash('sha256').update(JSON.stringify({job,profile_digest:f.deployment.authority.profiles.safe})).digest('hex');
  let row=(await store.reserve({...input,capacitySnapshot:await snapshot()})).reservation;row=await store.markLaunching(row.id,await client.capabilities(input.machineId));
  const body=r=>({reservation_id:r.id,machine_id:r.machine_id,owner_key:r.owner_key,intent_id:r.intent_id,launch_generation:r.launch_generation,config_digest:r.config_digest,worker_id:r.worker_id,worker_boot_id:r.worker_boot_id});
  if(mode==='unknown_create')await expect(client.start(input.machineId,{...body(row),job})).rejects.toThrow();
  else{
   const started=(await client.start(input.machineId,{...body(row),job})).receipt;
   if(mode==='success'){expect(started.terminal.stdout).toBe('actual-linux-output');row=await store.markRunning(row.id,started);}
   else{expect(started.status).toBe('waiting_resources');expect(docker.calls.some(a=>a[0]==='create')).toBe(false);}
  }
  expect((await pool.query('SELECT status FROM capacity_reservations WHERE id=$1',[row.id])).rows[0].status).not.toBe('released');
  const claim=await store.claimCleanup(row.id,'test-reaper',60000),cancel={...body(claim),container_id:claim.container_id,challenge:claim.cleanup_challenge};
  if(mode==='unknown_create'){
   await expect(client.cancel(input.machineId,cancel)).rejects.toThrow();expect(docker.calls.some(a=>a[0]==='rm')).toBe(false);
   expect((await pool.query('SELECT status FROM capacity_reservations WHERE id=$1',[row.id])).rows[0].status).toBe('cleanup_pending');
  }else{
   expect((await store.confirmCleanup(claim,await client.cancel(input.machineId,cancel))).status).toBe('released');
   if(mode==='success')expect(docker.calls.filter(a=>a[0]==='rm')).toEqual([['rm','--force','a'.repeat(64)]]);
  }
 }finally{runtime?.close();await new Promise(r=>{worker.close(r);worker.closeAllConnections();});if(bridge)await new Promise(r=>{bridge.close(r);bridge.closeAllConnections();});rmSync(root,{recursive:true,force:true});}
});
