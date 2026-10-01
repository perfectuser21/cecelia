import {readFileSync} from 'node:fs';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import pg from 'pg';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {DB_DEFAULTS} from '../../db-config.js';
import {fixture} from '../../linux-pool/runtime-receipt.test-fixture.js';
import {createLinuxRuntimeAuthorization} from '../../linux-pool/runtime-service.js';
import {directory} from '../../execution-directory/directory.js';
import {authorize,resolveCleanup} from '../../execution-directory/store.js';
import {routeWork} from '../../work-router.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
const database=process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname.slice(1):DB_DEFAULTS.database;
if(!/_(scratch|test)$/.test(database))throw Error('scratch/test database required');
const schema=`linux_script_${process.pid}_${randomUUID().replaceAll('-','')}`,admin=new pg.Client(options),pool=new pg.Pool({...options,max:8,options:`-c search_path=${schema},public`});
let f,machine,service,created=[];
const createTask=async args=>{routeWork({...args,requested_task_type:args.task_type});created.push(args);const task=(await args.db.query("INSERT INTO tasks(id,status,parent_task_id,payload) VALUES($1,$2,$3,$4) RETURNING *",[randomUUID(),args.status,args.parent_task_id,args.payload])).rows[0];return {success:true,task};};
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
 CREATE TABLE capacity_reservations(id UUID PRIMARY KEY);CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ);`);
 for(const file of ['503_execution_directory.sql','505_linux_pool_authorization.sql','507_linux_script_authorization.sql'])await pool.query(readFileSync(new URL('../../../migrations/'+file,import.meta.url),'utf8'));
});
beforeEach(async()=>{
 f=fixture();machine=randomUUID();f.deployment.expected.machine_registry_id=machine;f.deployment.authority.expected.machine_registry_id=machine;f.deployment.pool.machine_registry_id=machine;
 f.receipt.machine_registry_id=machine;f.receipt.cases[0].proof.machine_registry_id=machine;f.deployment.machine_id='linux-'+machine;f.receipt.machine_id=f.deployment.machine_id;
 for(const i of [f.receipt.cases[0].identity,f.receipt.cases[0].proof.identity,f.receipt.cases[0].cleanup]){i.machine_id=f.deployment.machine_id;i.worker_id=f.deployment.machine_id;}
 created=[];service=createLinuxRuntimeAuthorization({pool,readDeployment:async()=>f.deployment,createTask,afterTerminal:async()=>{}});
 await pool.query("INSERT INTO system_registry(id,type,name,status,metadata) VALUES($1,'machine',$2,'active','{\"role\":\"worker\"}')",[machine,f.deployment.machine_id]);
 await pool.query("INSERT INTO tasks(id,status) VALUES($1,'in_progress')",[f.deployment.parent_task_id]);
});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});
it('prepare自动子任务及pending同代许可；验签完成事实证据actor后才原子激活',async()=>{
 const p=await service.prepare(machine,{expected_version_id:null});expect(p.execution).toBe(false);expect(created).toHaveLength(1);expect(created[0].parent_task_id).toBe(f.deployment.parent_task_id);
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
