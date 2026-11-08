import {beforeAll,afterAll,beforeEach,it,expect} from 'vitest';
import pg from 'pg';
import {randomUUID,createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createManagedScriptProfileStore} from '../../execution-directory/managed-script-profile.js';
import {directory} from '../../execution-directory/directory.js';
import {DB_DEFAULTS} from '../../db-config.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
const database=process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname.slice(1):DB_DEFAULTS.database;
if(!/_(scratch|test)$/.test(database))throw Error('scratch/test database required');
const schema='script_profile_'+randomUUID().replaceAll('-',''),admin=new pg.Client(options),pool=new pg.Pool({...options,max:5,options:`-c search_path=${schema},public`});
const registry='ed3555dc-4777-446c-bdf0-d928d6a08ef1',version=randomUUID(),taskId=randomUUID(),releaseId=randomUUID(),observationId=randomUUID(),boot=randomUUID(),hash='a'.repeat(64),head='b'.repeat(40),profile='leadgen-candidate';
const input=()=>({expected_current_version_id:version,expected_config_hash:hash,expected_worker_boot_id:boot,expected_worker_config_digest:hash});
let c,reads;
const catalogToken='scratch-only-worker-transport-key';
const client={catalog:async()=>{reads++;const receipt={boot_id:boot,config_digest:hash,profile_sha256:hash};return {...receipt,receipt,signature:createHmac('sha256',catalogToken).update(JSON.stringify(receipt)).digest('hex')};}};
const store=(extra={})=>createManagedScriptProfileStore({pool,readCandidates:()=>({[profile]:c}),client,...extra});
beforeAll(async()=>{await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE system_registry(id uuid PRIMARY KEY,type text,name text,status text,metadata jsonb DEFAULT '{}');
 CREATE TABLE tasks(id uuid PRIMARY KEY,status text,result jsonb,updated_at timestamptz DEFAULT now());
 CREATE TABLE capacity_reservations(id uuid PRIMARY KEY);
 CREATE TABLE schema_version(version text PRIMARY KEY,description text,applied_at timestamptz);
 CREATE TABLE release_versions(id uuid PRIMARY KEY,environment text,target text,payload jsonb,manifest_sha256 text);
 CREATE TABLE release_observations(id uuid PRIMARY KEY,release_id uuid,payload jsonb,collector text,evidence_ref text,observed_at timestamptz,created_at timestamptz DEFAULT now());`);
 await pool.query(readFileSync(new URL('../../../migrations/503_execution_directory.sql',import.meta.url),'utf8'));
 await pool.query("INSERT INTO system_registry(id,type,name,status) VALUES($1,'machine','mac-mini-m4-us','active')",[registry]);
 await pool.query("INSERT INTO execution_nodes(machine_registry_id,canonical_id) VALUES($1,'us-mac-m4')",[registry]);
 await pool.query(`INSERT INTO execution_node_versions(id,machine_registry_id,revision,identity_mode,worker_id,platform,endpoints,profile,config_hash,state)
 VALUES($1,$2,1,'legacy-v1','us-mac-m4','darwin',$3,'{}',$4,'active')`,[version,registry,{worker:'http://100.71.151.105:5231'},hash]);
 await pool.query('UPDATE execution_nodes SET current_version_id=$2 WHERE machine_registry_id=$1',[registry,version]);
 const components=[{kind:'repo',repo:'perfectuser21/zenithjoy',revision:head}],verification={status:'verified',ci_status:'verified'};
 await pool.query("INSERT INTO release_versions VALUES($1,'candidate','us-mac-m4',$2,$3)",[releaseId,{components,verification},hash]);
 await pool.query('INSERT INTO release_observations(id,release_id,payload,collector,evidence_ref,observed_at) VALUES($1,$2,$3,$4,$5,now())',[observationId,releaseId,{environment:'candidate',target:'us-mac-m4',components},'trusted-deployer','owned:receipt']);
 await pool.query("INSERT INTO tasks(id,status,result) VALUES($1,'in_progress',$2)",[taskId,{ship_candidate:{schema_version:1,stage:'candidate',task_id:taskId,repo:'perfectuser21/zenithjoy',head_sha:head,actor:'real-candidate',facts:['候选'],evidence:[{path:'owned:ci'}]}}]);
});
beforeEach(()=>{reads=0;c={machine_id:'us-mac-m4',machine_registry_id:registry,profile_sha256:hash,source_repo:'perfectuser21/zenithjoy',source_commit:head,release_id:releaseId,observation_id:observationId,evidence_task_id:taskId,expires_at:new Date(Date.now()+3600000).toISOString()};});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});
it('真实PG错误CAS、源头、部署观测、Worker变化均零grant写入',async()=>{
 await expect(store().activate(profile,{...input(),expected_config_hash:'c'.repeat(64)})).rejects.toThrow('execution_script_version_stale');
 c.source_commit='c'.repeat(40);await expect(store().activate(profile,input())).rejects.toThrow('execution_script_candidate_evidence_required');c.source_commit=head;
 c.observation_id=randomUUID();await expect(store().activate(profile,input())).rejects.toThrow('execution_script_release_unverified');c.observation_id=observationId;
 await pool.query("UPDATE release_versions SET payload=jsonb_set(payload,'{verification,ci_status}','\"unknown\"') WHERE id=$1",[releaseId]);
 await expect(store().activate(profile,input())).rejects.toThrow('execution_script_release_unverified');
 await pool.query("UPDATE release_versions SET payload=jsonb_set(payload,'{verification,ci_status}','\"verified\"') WHERE id=$1",[releaseId]);
 const unstable={catalog:async()=>({boot_id:reads++?randomUUID():boot,config_digest:hash,profile_sha256:hash})};
 await expect(store({client:unstable}).activate(profile,input())).rejects.toThrow('execution_script_worker_changed');
 expect((await pool.query('SELECT * FROM execution_grants')).rows).toHaveLength(0);
});
it('真实PG同机锁串行，active精确grant与真实任务审计同事务追加，幂等不改旧grant',async()=>{
 await pool.query("UPDATE tasks SET result=jsonb_set(result,'{merge_sha}',$2::jsonb)||jsonb_build_object('ship_candidate',(result->'ship_candidate')||jsonb_build_object('head_sha',$3::text)) WHERE id=$1",[taskId,JSON.stringify(head),'c'.repeat(40)]);
 const body=input(),publisher=store();const [a,b]=await Promise.all([publisher.activate(profile,body),publisher.activate(profile,body)]);
 expect(a.grant_id).toBe(b.grant_id);expect([a.already_active,b.already_active].sort()).toEqual([false,true]);expect(reads).toBe(4);
 const grants=(await pool.query('SELECT * FROM execution_grants')).rows;expect(grants).toHaveLength(1);expect(grants[0]).toMatchObject({state:'active',profile_id:profile,evidence_task_id:taskId,node_version_id:version});
 const task=(await pool.query('SELECT status,result FROM tasks WHERE id=$1',[taskId])).rows[0];expect(task.status).toBe('in_progress');expect(task.result.execution_script_profile_operations).toHaveLength(1);
 for(const catalog of task.result.execution_script_profile_operations[0].worker_catalog){expect(JSON.parse(catalog.signed_payload)).toEqual(catalog.receipt);expect(createHmac('sha256',catalogToken).update(catalog.signed_payload).digest('hex')).toBe(catalog.signature);}
 expect(directory.matches({machineId:'us-mac-m4',surface:'managed_script',provider:'script',profileId:profile})).not.toBeNull();
 expect((await pool.query('SELECT count(*) FROM execution_node_versions')).rows[0].count).toBe('1');
});
it('真实PG已撤销profile重试不能静默复活或造新grant',async()=>{
 await pool.query("UPDATE execution_grants SET state='revoked' WHERE profile_id=$1",[profile]);
 await expect(store().activate(profile,input())).rejects.toThrow('execution_script_grant_revoked');
 expect((await pool.query('SELECT count(*) FROM execution_grants')).rows[0].count).toBe('1');
});
it('激活在等待证据Task行锁时不先持有机器capacity锁，避免Task→capacity反序死锁',async()=>{
 const blocker=await pool.connect(),probe=await pool.connect();let activation;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[taskId]);
  activation=store().activate(profile,input());activation.catch(()=>{});
  await new Promise(r=>setTimeout(r,60));await probe.query('BEGIN');
  const free=(await probe.query("SELECT pg_try_advisory_xact_lock(hashtextextended('harness_attempt_machine:us-mac-m4',0)) AS free")).rows[0].free;
  expect(free).toBe(true);
 }finally{await probe.query('ROLLBACK');probe.release();await blocker.query('ROLLBACK');blocker.release();await activation?.catch(()=>{});}
});
