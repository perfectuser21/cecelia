import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { createLinuxPoolAuthorization } from '../../linux-pool/service.js';
import { normalizeDeployment } from '../../linux-pool/deployment.js';
import { directory } from '../../execution-directory/directory.js';
import { authorize, resolveCleanup } from '../../execution-directory/store.js';
import { MACHINE_CAPACITY_LOCK_SQL } from '../../orchestrator/attempt-machine-capacity.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
const database=process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname.slice(1):DB_DEFAULTS.database;
if(!/_(scratch|test)$/.test(database))throw Error('scratch/test database required');
const schema=`linux_pool_${process.pid}_${randomUUID().replaceAll('-','')}`;
const admin=new pg.Client(options),pool=new pg.Pool({...options,max:8,options:`-c search_path=${schema},public`});
let machine,config,service,token;
function setup(id=randomUUID()){
 machine=id;token='a'.repeat(64);
 config={profile:{schema_version:1,machine_registry_id:id,machine_id:'linux-'+id,role:'worker',endpoint_host:'100.90.1.4',docker_host:'unix:///var/run/docker.sock',pool:{cpu_cores:2,memory_bytes:2**30,pids_limit:128},canary_image:'test/canary@sha256:'+'b'.repeat(64)},revision:'c'.repeat(40),host_boot_id:randomUUID(),worker_boot_id:randomUUID(),daemon_id:'daemon-fixture',image_id:'sha256:'+'d'.repeat(64),script_profiles:['readonly-report'],credential_file:'/etc/cecelia/credentials/linux-pool.token'};
 service=createLinuxPoolAuthorization({pool,readDeployment:async id=>{if(id!==machine)throw Error('linux_pool_deployment_unavailable');return normalizeDeployment(config,token);}});
}
function envelope(challenge,mutate=()=>{}){
 const expected=normalizeDeployment(config,token).expected;
 const receipt={schema_version:'linux-pool-canary/v1',nonce:challenge.nonce,machine_registry_id:machine,machine_id:config.profile.machine_id,config_digest:expected.config_digest,revision:config.revision,host_boot_id:config.host_boot_id,worker_boot_id:config.worker_boot_id,daemon_id:config.daemon_id,container_id:'e'.repeat(64),image_id:config.image_id,started_at:new Date().toISOString(),completed_at:new Date().toISOString(),execution:false,pool_verified:true,cleanup_confirmed:true};
 receipt.proof={schema_version:'linux-pool-proof/v1',execution:false,pool_verified:true,machine_registry_id:machine,config_digest:receipt.config_digest,host_boot_id:receipt.host_boot_id,daemon_id:receipt.daemon_id,container_id:receipt.container_id,observed_at:receipt.started_at,cgroup_parent:'cecelia-workloads.slice',cgroup_parent_path:'/cecelia.slice/cecelia-workloads.slice',host_cgroup_namespace:'cgroup:[123]',container_pid:456,container_start_time:'123456',cpu_cores:1,memory_limit_bytes:2**30,memory_available_bytes:2**29,pids_limit:128,pids_available:100,disk_free_bytes:2**30,disk_used_percent:20};
 mutate(receipt);return {receipt,signature:createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex')};
}
async function accepted(){const c=await service.challenge(machine,{expected_version_id:null});const a=await service.attest(machine,{challenge_id:c.id,envelope:envelope(c)});return {c,a};}
beforeAll(async()=>{await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);await pool.query(`CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,name TEXT,status TEXT,metadata JSONB DEFAULT '{}');CREATE TABLE tasks(id UUID PRIMARY KEY,status TEXT);CREATE TABLE capacity_reservations(id UUID PRIMARY KEY);CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ);`);
 for(const filename of ['503_execution_directory.sql','505_linux_pool_authorization.sql'])await pool.query(readFileSync(new URL('../../../migrations/'+filename,import.meta.url),'utf8'));
});
beforeEach(async()=>{setup();await pool.query("INSERT INTO system_registry(id,type,name,status,metadata) VALUES($1,'machine',$2,'active','{\"role\":\"worker\"}')",[machine,config.profile.machine_id]);});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});
it('真实nonce消费、验收和CAS只产生pending脚本授权；ready不表示可派发',async()=>{
 const {c,a}=await accepted();const ready=await service.activate(machine,{attestation_id:a.id,expected_version_id:null});
 expect(ready).toMatchObject({authorization_state:'ready',execution:false});
 const grant=(await pool.query('SELECT * FROM execution_grants WHERE node_version_id=$1',[ready.execution_version_id])).rows;
 expect(grant).toHaveLength(1);expect(grant[0]).toMatchObject({surface:'managed_script',provider:'script',profile_id:'readonly-report',state:'pending'});
 expect((await pool.query('SELECT consumed_at FROM linux_pool_challenges WHERE id=$1',[c.id])).rows[0].consumed_at).toBeTruthy();
 await directory.refresh({pool});let launches=0;
 await expect(authorize(pool,{snapshotVersion:directory.current().version,machineId:config.profile.machine_id,surface:'managed_script',provider:'script',profileId:'readonly-report'},()=>launches++)).rejects.toThrow('execution_version_stale');expect(launches).toBe(0);
 await expect(pool.query("UPDATE execution_node_versions SET state='active' WHERE id=$1",[ready.execution_version_id])).rejects.toThrow('execution_attested_activation_not_enabled');
});
it('没有完成清理、签名篡改、错误boot/config/daemon/镜像和旧时间均不消费nonce',async()=>{
 const c=await service.challenge(machine,{expected_version_id:null});
 for(const change of [r=>r.cleanup_confirmed=false,r=>r.worker_boot_id=randomUUID(),r=>r.host_boot_id=randomUUID(),r=>r.daemon_id='other',r=>r.config_digest='f'.repeat(64),r=>r.image_id='sha256:'+'f'.repeat(64),r=>r.completed_at='2000-01-01T00:00:00.000Z',r=>r.proof.container_id='f'.repeat(64)])await expect(service.attest(machine,{challenge_id:c.id,envelope:envelope(c,change)})).rejects.toThrow('linux_pool_receipt_invalid');
 const bad=envelope(c);bad.signature='f'.repeat(64);await expect(service.attest(machine,{challenge_id:c.id,envelope:bad})).rejects.toThrow('linux_pool_receipt_invalid');
 expect((await pool.query('SELECT consumed_at FROM linux_pool_challenges WHERE id=$1',[c.id])).rows[0].consumed_at).toBeNull();
 await service.attest(machine,{challenge_id:c.id,envelope:envelope(c)});
 await expect(service.attest(machine,{challenge_id:c.id,envelope:envelope(c)})).rejects.toThrow('linux_pool_challenge_unavailable');
});
it('并发消费只接受一次，并发激活CAS只创建一个版本',async()=>{
 const c=await service.challenge(machine,{expected_version_id:null}),input={challenge_id:c.id,envelope:envelope(c)};
 const results=await Promise.allSettled([service.attest(machine,input),service.attest(machine,input)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const id=results.find(r=>r.status==='fulfilled').value.id;
 const activated=await Promise.allSettled([service.activate(machine,{attestation_id:id,expected_version_id:null}),service.activate(machine,{attestation_id:id,expected_version_id:null})]);
 expect(activated.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(Number((await pool.query('SELECT count(*) FROM execution_node_versions WHERE machine_registry_id=$1',[machine])).rows[0].count)).toBe(1);
});
it('HTTP输入不能注入endpoint/token/expected身份，部署期望更换使旧挑战失效',async()=>{
 await expect(service.challenge(machine,{expected_version_id:null,endpoint:'http://evil/'})).rejects.toThrow('linux_pool_request_invalid');
 const c=await service.challenge(machine,{expected_version_id:null});
 await expect(service.attest(machine,{challenge_id:c.id,envelope:envelope(c),token})).rejects.toThrow('linux_pool_request_invalid');
 config.worker_boot_id=randomUUID();await expect(service.attest(machine,{challenge_id:c.id,envelope:envelope(c)})).rejects.toThrow('linux_pool_deployment_changed');
});
it('US固定UUID以及scheduler元数据或受信role、zero预算禁止挑战',async()=>{
 await pool.query("UPDATE system_registry SET metadata='{\"role\":\"scheduler\"}' WHERE id=$1",[machine]);
 await expect(service.challenge(machine,{expected_version_id:null})).rejects.toThrow('linux_pool_machine_forbidden');
 await pool.query("UPDATE system_registry SET metadata='{}' WHERE id=$1",[machine]);
 config.profile.role='scheduler';await expect(service.challenge(machine,{expected_version_id:null})).rejects.toThrow('linux_pool_deployment_invalid');
 config.profile.role='worker';config.profile.pool.cpu_cores=0;await expect(service.challenge(machine,{expected_version_id:null})).rejects.toThrow('linux_pool_deployment_invalid');
 setup('1a379d80-ad36-47d3-88ba-e545ab299a54');await expect(service.challenge(machine,{expected_version_id:null})).rejects.toThrow('linux_pool_machine_forbidden');
});
it('挑战超时及接受后过期无法激活，数据库时钟判定',async()=>{
 const c=await service.challenge(machine,{expected_version_id:null});
 await pool.query("UPDATE linux_pool_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[c.id]);
 await expect(service.attest(machine,{challenge_id:c.id,envelope:envelope(c)})).rejects.toThrow('linux_pool_challenge_unavailable');
 const {a}=await accepted();await pool.query("UPDATE linux_pool_attestations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[a.id]);
 await expect(service.activate(machine,{attestation_id:a.id,expected_version_id:null})).rejects.toThrow('linux_pool_attestation_unavailable');
});
it('撤销与预约同machine锁串行；撤销后的重试不复活，历史版本仍可定位清理',async()=>{
 const {a}=await accepted(),ready=await service.activate(machine,{attestation_id:a.id,expected_version_id:null});
 const client=await pool.connect();await client.query('BEGIN');await client.query(MACHINE_CAPACITY_LOCK_SQL,[config.profile.machine_id]);
 let finished=false;const revoking=service.revoke(machine,{attestation_id:a.id,expected_version_id:ready.execution_version_id}).then(()=>finished=true);
 await new Promise(r=>setTimeout(r,35));expect(finished).toBe(false);await client.query('COMMIT');client.release();await revoking;
 await expect(service.activate(machine,{attestation_id:a.id,expected_version_id:ready.execution_version_id})).rejects.toThrow('linux_pool_attestation_unavailable');
 expect((await service.get(machine)).execution).toBe(false);
 expect((await resolveCleanup(pool,{executionVersionId:ready.execution_version_id,persistedAttemptIdentity:{machine_id:config.profile.machine_id,execution_version_id:ready.execution_version_id}})).id).toBe(ready.execution_version_id);
});
it('验收历史及绑定不可改；CAS失败完整回滚不会留下版本/grant',async()=>{
 const {a}=await accepted();
 await expect(pool.query("UPDATE linux_pool_attestations SET receipt='{}' WHERE id=$1",[a.id])).rejects.toThrow('linux_pool_history_immutable');
 await expect(service.activate(machine,{attestation_id:a.id,expected_version_id:randomUUID()})).rejects.toThrow('linux_pool_version_conflict');
 expect(Number((await pool.query('SELECT count(*) FROM execution_node_versions WHERE machine_registry_id=$1',[machine])).rows[0].count)).toBe(0);
 await service.activate(machine,{attestation_id:a.id,expected_version_id:null});
});
it('配置丢失/换代或机器禁用后仍能撤销持久身份，不依赖当前部署可用',async()=>{
 const {a}=await accepted(),ready=await service.activate(machine,{attestation_id:a.id,expected_version_id:null});
 const unavailable=createLinuxPoolAuthorization({pool,readDeployment:async()=>{throw Error('credential unavailable');}});
 await pool.query("UPDATE system_registry SET status='inactive',metadata='{\"role\":\"scheduler\"}' WHERE id=$1",[machine]);
 await expect(unavailable.revoke(machine,{attestation_id:a.id,expected_version_id:ready.execution_version_id})).resolves.toMatchObject({authorization_state:'revoked'});
});
it('已发行挑战可单独撤销，随后正确签名也不能消费',async()=>{
 const c=await service.challenge(machine,{expected_version_id:null});
 await service.revoke(machine,{challenge_id:c.id,expected_version_id:null});
 await expect(service.attest(machine,{challenge_id:c.id,envelope:envelope(c)})).rejects.toThrow('linux_pool_challenge_unavailable');
});
it('撤销先提交后，竞争激活拒绝且零版本落盘',async()=>{
 const {a}=await accepted();await service.revoke(machine,{attestation_id:a.id,expected_version_id:null});
 await expect(service.activate(machine,{attestation_id:a.id,expected_version_id:null})).rejects.toThrow('linux_pool_attestation_unavailable');
 expect(Number((await pool.query('SELECT count(*) FROM execution_node_versions WHERE machine_registry_id=$1',[machine])).rows[0].count)).toBe(0);
});
it('等待机器锁期间挑战到期，拿锁后重新按数据库时钟拒绝',async()=>{
 const c=await service.challenge(machine,{expected_version_id:null});
 await pool.query("UPDATE linux_pool_challenges SET expires_at=clock_timestamp()+interval '80 milliseconds' WHERE id=$1",[c.id]);
 const client=await pool.connect();await client.query('BEGIN');await client.query(MACHINE_CAPACITY_LOCK_SQL,[config.profile.machine_id]);
 const checking=service.attest(machine,{challenge_id:c.id,envelope:envelope(c)});
 const rejected=expect(checking).rejects.toThrow('linux_pool_challenge_unavailable');
 await new Promise(r=>setTimeout(r,100));await client.query('COMMIT');client.release();await rejected;
 expect((await pool.query('SELECT consumed_at FROM linux_pool_challenges WHERE id=$1',[c.id])).rows[0].consumed_at).toBeNull();
});
it('激活提交后撤销同代，撤销后的实际authorize零副作用并保留历史',async()=>{
 const {a}=await accepted();const ready=await service.activate(machine,{attestation_id:a.id,expected_version_id:null});
 await service.revoke(machine,{attestation_id:a.id,expected_version_id:ready.execution_version_id});let launches=0;
 await expect(authorize(pool,{snapshotVersion:directory.current().version,machineId:config.profile.machine_id,surface:'managed_script',provider:'script',profileId:'readonly-report',executionVersionId:ready.execution_version_id},()=>launches++)).rejects.toThrow('execution_version_stale');
 expect(launches).toBe(0);expect((await pool.query('SELECT state FROM execution_grants WHERE node_version_id=$1',[ready.execution_version_id])).rows.every(g=>g.state==='revoked')).toBe(true);
});
it('授予中途数据库失败回滚完整版本/许可/nonce验收状态',async()=>{
 const {a}=await accepted();
 await pool.query(`CREATE FUNCTION reject_linux_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.profile_id='readonly-report' THEN RAISE EXCEPTION 'fixture_storage_failure'; END IF;RETURN NEW;END $$;CREATE TRIGGER reject_linux_grant BEFORE INSERT ON execution_grants FOR EACH ROW EXECUTE FUNCTION reject_linux_grant()`);
 try{await expect(service.activate(machine,{attestation_id:a.id,expected_version_id:null})).rejects.toThrow('fixture_storage_failure');}
 finally{await pool.query('DROP TRIGGER reject_linux_grant ON execution_grants;DROP FUNCTION reject_linux_grant()');}
 expect((await pool.query('SELECT id FROM execution_node_versions WHERE machine_registry_id=$1',[machine])).rows).toEqual([]);
 expect((await pool.query('SELECT state,execution_version_id FROM linux_pool_attestations WHERE id=$1',[a.id])).rows[0]).toEqual({state:'accepted',execution_version_id:null});
 await expect(service.activate(machine,{attestation_id:a.id,expected_version_id:null})).resolves.toMatchObject({authorization_state:'ready'});
});
it('通用台账PATCH修改executors不会生成任何许可，ready仍不能改成active',async()=>{
 const {a}=await accepted();await pool.query("UPDATE system_registry SET metadata='{\"executors\":[\"codex\",\"script\"],\"enabled\":true}' WHERE id=$1",[machine]);
 expect((await pool.query('SELECT machine_registry_id FROM execution_nodes WHERE machine_registry_id=$1',[machine])).rows).toEqual([]);
 const ready=await service.activate(machine,{attestation_id:a.id,expected_version_id:null});
 await pool.query("INSERT INTO tasks(id,status) VALUES($1,'completed')",[randomUUID()]);
 await expect(pool.query("UPDATE execution_node_versions SET state='active' WHERE id=$1",[ready.execution_version_id])).rejects.toThrow('execution_attested_activation_not_enabled');
});
it('只有完整宿主slice资源证明能验收，缺失或越过注册池预算拒绝',async()=>{
 const c=await service.challenge(machine,{expected_version_id:null});
 for(const mutate of [r=>delete r.proof.cgroup_parent,r=>r.proof.cgroup_parent_path='/foreign.slice',r=>r.proof.cpu_cores=9999,r=>r.proof.memory_limit_bytes=2**40,r=>r.proof.pids_limit=99999])await expect(service.attest(machine,{challenge_id:c.id,envelope:envelope(c,mutate)})).rejects.toThrow('linux_pool_receipt_invalid');
});
