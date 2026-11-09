import {beforeAll,afterAll,beforeEach,it,expect} from 'vitest';
import pg from 'pg';
import {randomUUID,createHmac} from 'node:crypto';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readManagedScriptCandidates,assertManagedScriptProfileGrant} from '../../execution-directory/managed-script-profile-evidence.js';
import {freezeManagedScriptWorkerRoute,resolveFrozenManagedScriptWorkerRoute,createProfileCatalogClient} from '../../execution-directory/managed-script-profile-evidence.js';
import {reserveCommonRunnerWorkerRoute} from '../../lib/task-run.js';
import {createRequire} from 'node:module';
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
const client={catalog:async()=>{reads++;const receipt={profile_sha256:hash,config_digest:hash,boot_id:boot};const signed_payload=JSON.stringify(receipt);return {...receipt,receipt,signed_payload,signature:createHmac('sha256',catalogToken).update(signed_payload).digest('hex')};}};
const store=(extra={})=>createManagedScriptProfileStore({pool,readCandidates:()=>({[profile]:c}),client,...extra});
beforeAll(async()=>{await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE system_registry(id uuid PRIMARY KEY,type text,name text,status text,metadata jsonb DEFAULT '{}');
 CREATE TABLE tasks(id uuid PRIMARY KEY,status text,result jsonb,updated_at timestamptz DEFAULT now());
 CREATE TABLE capacity_reservations(id uuid PRIMARY KEY);
 CREATE TABLE schema_version(version text PRIMARY KEY,description text,applied_at timestamptz);
 CREATE TABLE release_versions(id uuid PRIMARY KEY,environment text,target text,payload jsonb,manifest_sha256 text);
 CREATE TABLE release_observations(id uuid PRIMARY KEY,release_id uuid,payload jsonb,collector text,evidence_ref text,observed_at timestamptz,created_at timestamptz DEFAULT now());`);
 await pool.query(`CREATE TABLE task_runs(id uuid PRIMARY KEY,task_id uuid,run_id uuid UNIQUE,status text,ended_at timestamptz,workflow_id uuid,context jsonb);
 CREATE TABLE run_definition_bindings(task_run_id uuid,run_id uuid,source_kind text,workflow_id uuid);`);
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
it('真实PG等待release锁期间证据Task撤销后不能用锁前快照准入',async()=>{
 const grant=(await pool.query('SELECT * FROM execution_grants WHERE profile_id=$1',[profile])).rows[0];c.expires_at=grant.expires_at.toISOString();
 const root=mkdtempSync(join(tmpdir(),'script-live-evidence-')),file=join(root,'policy.json');writeFileSync(file,JSON.stringify({schema_version:1,profiles:{[profile]:c}}),{mode:0o600});
 const blocker=await pool.connect(),reader=await pool.connect();let pending;
 try{
  await blocker.query('BEGIN');await reader.query('BEGIN');
  await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`release-target:${JSON.stringify(['candidate','us-mac-m4'])}`]);
  const pid=(await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=assertManagedScriptProfileGrant({db:reader,grant,profileId:profile,profileSha256:hash,machineId:'us-mac-m4',executionVersionId:version},{EXECUTION_MANAGED_SCRIPT_CANDIDATES_FILE:file});pending.catch(()=>{});
  const deadline=Date.now()+3000;let waiting=false;
  while(Date.now()<deadline){const state=(await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];if(state.wait_event_type==='Lock'){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}
  expect(waiting).toBe(true);await pool.query("UPDATE tasks SET status='cancelled' WHERE id=$1",[taskId]);await blocker.query('ROLLBACK');
  await expect(pending).rejects.toThrow('execution_script_candidate_evidence_required');
 }finally{await blocker.query('ROLLBACK');blocker.release();await reader.query('ROLLBACK');reader.release();await pending?.catch(()=>{});await pool.query("UPDATE tasks SET status='in_progress' WHERE id=$1",[taskId]);rmSync(root,{recursive:true,force:true});}
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
it('真实PG与HTTP候选catalog只访问15231，保原node/全局capacity身份并保存真实HMAC原件',async()=>{
 const require=createRequire(import.meta.url),{createFleetWorkerServer}=require('../../../scripts/fleet-worker/fleet-worker.cjs'),token='private-pg-candidate-worker-token-'.repeat(2),endpoints=[];
 Object.assign(c,{worker_endpoint:'http://100.71.151.105:15231',worker_boot_id:boot,worker_config_digest:hash});
 const server=createFleetWorkerServer({machineId:'us-mac-m4',attemptToken:token,launchAdmission:{snapshot:()=>({boot_id:boot,activity_revision:0})},runtimeConfigDigest:hash,workflowProfileCatalog:()=>hash});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const liveClient=createProfileCatalogClient({token,fetchFn:(url,options)=>{endpoints.push(new URL(url).origin);return fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`,options);}});
  const publisher=createManagedScriptProfileStore({pool,client:liveClient,readCandidates:()=>({'isolated-candidate':c})});
  await expect(publisher.activate('isolated-candidate',{...input(),expected_worker_boot_id:randomUUID()})).rejects.toThrow('execution_script_worker_changed');expect(endpoints).toEqual([]);
  const result=await publisher.activate('isolated-candidate',input());expect(result.committed).toBe(true);expect(endpoints).toEqual([c.worker_endpoint,c.worker_endpoint]);
  expect(directory.current().nodes[0].endpoints.worker).toBe('http://100.71.151.105:5231');
  const audit=(await pool.query('SELECT result FROM tasks WHERE id=$1',[taskId])).rows[0].result.execution_script_profile_operations.at(-1);
  for(const envelope of audit.worker_catalog)expect(createHmac('sha256',token).update(envelope.signed_payload).digest('hex')).toBe(envelope.signature);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
it('真实TaskRun首次marker同事务CAS消费，JSONB冻结路由不受Task.result删除影响且旧无marker不可补授权',async()=>{
 const token='private-pg-frozen-route-key-'.repeat(2),run=randomUUID(),row=randomUUID(),workflow=randomUUID(),db=await pool.connect();
 Object.assign(c,{worker_endpoint:'http://100.71.151.105:15231',worker_boot_id:boot,worker_config_digest:hash});
 const node=directory.current().nodes[0],grant=(await pool.query("SELECT * FROM execution_grants WHERE profile_id='isolated-candidate'")).rows[0];
 // Use the actual policy pinned by this grant, including its original expiry.
 const originalAudit=(await pool.query('SELECT result FROM tasks WHERE id=$1',[taskId])).rows[0].result.execution_script_profile_operations.at(-1);c.expires_at=originalAudit.expires_at;
 const route=freezeManagedScriptWorkerRoute({policy:c,node,grant,executionVersionId:version,runId:run,taskId,profileId:'isolated-candidate'},token);
 const marker={schema_version:'common-runner-worker-reservation/v1',state:'unlaunched',task_id:taskId,run_id:run};
 await pool.query("INSERT INTO task_runs VALUES($1,$2,$3,'running',NULL,$4,$5)",[row,taskId,run,workflow,{source:'workflow-common-runner',common_runner_worker_reservation:marker}]);
 await db.query('BEGIN');
 try{
  await expect(reserveCommonRunnerWorkerRoute({taskId,runId:run,route},{transactionClient:db})).rejects.toThrow('common_runner_worker_route_unproven');
  await db.query('INSERT INTO run_definition_bindings VALUES($1,$2,\'internal\',$3)',[row,run,workflow]);
  await reserveCommonRunnerWorkerRoute({taskId,runId:run,route},{transactionClient:db});
  await expect(reserveCommonRunnerWorkerRoute({taskId,runId:run,route},{transactionClient:db})).rejects.toThrow('common_runner_worker_route_unproven');
  const context=(await db.query('SELECT context FROM task_runs WHERE run_id=$1',[run])).rows[0].context;
  expect(context.common_runner_worker_reservation).toBeUndefined();
  const binding={run_id:run,task_id:taskId,machine_id:node.canonical_id,execution_version_id:version,execution_grant_id:grant.id,profile:'isolated-candidate',profile_sha256:hash,worker_route:context.common_runner_worker_route};
  expect(resolveFrozenManagedScriptWorkerRoute(binding,node,token).endpoint).toBe(c.worker_endpoint);
  binding.worker_route.payload.endpoint='http://100.71.151.105:5231';expect(()=>resolveFrozenManagedScriptWorkerRoute(binding,node,token)).toThrow('execution_script_worker_route_invalid');
 }finally{await db.query('ROLLBACK');db.release();}
});

it('现役西安Mac真实PG与HTTP候选准入绑定实际registry和source target，冻结路由保留原origin',async()=>{
 const machine='xian-mac-m4',reg='af1834a6-a55d-4021-8490-143d5686c49e',ver=randomUUID(),release=randomUUID(),obs=randomUUID();
 const original='http://100.86.57.69:6231',endpoint='http://100.86.57.69:16231',id='xian-isolated-candidate',token='scratch-xian-candidate-key-'.repeat(2);
 await pool.query("INSERT INTO system_registry VALUES($1,'machine','mac-mini-m4-xian','active','{}')",[reg]);
 await pool.query('INSERT INTO execution_nodes(machine_registry_id,canonical_id) VALUES($1,$2)',[reg,machine]);
 await pool.query(`INSERT INTO execution_node_versions(id,machine_registry_id,revision,identity_mode,worker_id,platform,endpoints,profile,config_hash,state) VALUES($1,$2,1,'legacy-v1',$3,'darwin',$4,'{}',$5,'active')`,[ver,reg,machine,{worker:original},hash]);
 await pool.query('UPDATE execution_nodes SET current_version_id=$2 WHERE machine_registry_id=$1',[reg,ver]);
 const components=[{kind:'repo',repo:c.source_repo,revision:head}];
 await pool.query("INSERT INTO release_versions VALUES($1,'candidate','xian-m4',$2,$3)",[release,{components,verification:{status:'verified',ci_status:'verified'}},hash]);
 await pool.query("INSERT INTO release_observations(id,release_id,payload,collector,evidence_ref,observed_at) VALUES($1,$2,$3,'trusted-deployer','owned:xian',now())",[obs,release,{environment:'candidate',target:'xian-m4',components}]);
 const policy={...c,machine_id:machine,machine_registry_id:reg,release_id:release,observation_id:obs,worker_endpoint:endpoint,worker_boot_id:boot,worker_config_digest:hash};
 const root=mkdtempSync(join(tmpdir(),'script-xian-')),file=join(root,'policy.json');writeFileSync(file,JSON.stringify({schema_version:1,profiles:{[id]:policy}}),{mode:0o600});
 const {createFleetWorkerServer}=createRequire(import.meta.url)('../../../scripts/fleet-worker/fleet-worker.cjs');let calls=0;
 const server=createFleetWorkerServer({machineId:machine,attemptToken:token,launchAdmission:{snapshot:()=>({boot_id:boot,activity_revision:0})},runtimeConfigDigest:hash,workflowProfileCatalog:()=>hash});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const env={EXECUTION_MANAGED_SCRIPT_CANDIDATES_FILE:file},live=createProfileCatalogClient({token,fetchFn:(url,options)=>{calls++;expect(new URL(url).origin).toBe(endpoint);return fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`,options);}});
  expect(readManagedScriptCandidates(file)[id]).toEqual(policy);
  const publisher=createManagedScriptProfileStore({pool,env,client:live});
  const result=await publisher.activate(id,{...input(),expected_current_version_id:ver});expect(result.committed).toBe(true);expect(calls).toBe(2);
  const grant=(await pool.query('SELECT * FROM execution_grants WHERE id=$1',[result.grant_id])).rows[0],node=directory.current().nodes.find(n=>n.canonical_id===machine);
  expect(node.endpoints.worker).toBe(original);expect(grant.node_version_id).toBe(ver);
  expect(await assertManagedScriptProfileGrant({db:pool,grant,profileId:id,profileSha256:hash,machineId:machine,executionVersionId:ver},env)).toEqual(policy);
  const run=randomUUID(),route=freezeManagedScriptWorkerRoute({policy,node,grant,executionVersionId:ver,runId:run,taskId,profileId:id},token);
  const binding={run_id:run,task_id:taskId,machine_id:machine,execution_version_id:ver,execution_grant_id:grant.id,profile:id,profile_sha256:hash,worker_route:JSON.parse(JSON.stringify(route))};
  expect(resolveFrozenManagedScriptWorkerRoute(binding,node,token).endpoint).toBe(endpoint);
  expect(()=>resolveFrozenManagedScriptWorkerRoute(binding,{...node,endpoints:{worker:'http://100.86.57.69:7231'}},token)).toThrow('identity_mismatch');
  for(const patch of [{machine_registry_id:registry},{worker_endpoint:original},{worker_endpoint:'http://100.71.151.105:16231'}]){
   writeFileSync(file,JSON.stringify({schema_version:1,profiles:{[id]:{...policy,...patch}}}));
   await expect(publisher.activate(id,{...input(),expected_current_version_id:ver})).rejects.toThrow();expect(calls).toBe(2);
  }
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});}
});
