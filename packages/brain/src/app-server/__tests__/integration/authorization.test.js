import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {DB_DEFAULTS} from '../../../db-config.js';
import {importLegacyPolicy} from '../../../execution-directory/store.js';
import {LEGACY_BINDINGS} from '../../../execution-directory/legacy-policy.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
if(!/_(scratch|test)$/.test(process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname:DB_DEFAULTS.database))throw Error('scratch/test database required');
const schema=`app_auth_${process.pid}_${randomUUID().replaceAll('-','')}`;
const admin=new pg.Client(options),pool=new pg.Pool({...options,max:4,options:`-c search_path=${schema},public`});
let version;
beforeAll(async()=>{
 await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,name TEXT,status TEXT,metadata JSONB DEFAULT '{}');
  CREATE TABLE tasks(id UUID PRIMARY KEY,status TEXT,task_type TEXT CONSTRAINT tasks_task_type_check CHECK(task_type IN ('dev','janitor')),executor_kind TEXT CONSTRAINT tasks_executor_kind_check CHECK(executor_kind IN ('headed-session','preview-janitor')));
  CREATE TABLE initiative_runs(id UUID PRIMARY KEY,phase TEXT DEFAULT 'planning',map_recovery_contract_id UUID,orchestrator_version TEXT DEFAULT 'v2');CREATE TABLE map_recovery_consumptions(contract_id UUID,attempt_id UUID);
  CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ);`);
 for(const [,id,name]of LEGACY_BINDINGS)await pool.query("INSERT INTO system_registry(id,type,name,status) VALUES($1,'machine',$2,'active')",[id,name]);
 for(const name of ['357_harness_provider_attempts','362_kernel_attempt_telemetry_reconcile','363_kernel_fleet_execution_receipts','364_kernel_local_container_naming','425_harness_attempt_cleanup_outbox','501_capacity_reservations','503_execution_directory','504_app_server_generations','506_app_server_streams'])await pool.query(readFileSync(new URL(`../../../../migrations/${name}.sql`,import.meta.url),'utf8'));
 await importLegacyPolicy({pool,env:{FLEET_WORKER_US_MAC_M4_URL:'http://mmv:5231',FLEET_WORKER_XIAN_MAC_M1_URL:'http://m1:5231',FLEET_WORKER_XIAN_MAC_M4_URL:'http://m4:5231'}});
 version=(await pool.query("SELECT current_version_id FROM execution_nodes WHERE canonical_id='xian-mac-m1'")).rows[0].current_version_id;
 const migration=new URL('../../../../migrations/508_app_server_authorizations.sql',import.meta.url);
 await pool.query(readFileSync(migration,'utf8'));
 await pool.query(readFileSync(new URL('../../../../migrations/509_app_server_canary_attempts.sql',import.meta.url),'utf8'));
});
async function transaction(fn){const db=await pool.connect();try{await db.query('BEGIN');const value=await fn(db);await db.query('COMMIT');return value;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
async function prepared(profile=`chat-${randomUUID()}`,challenge='10 minutes'){
 const row={id:randomUUID(),grant:randomUUID(),task:randomUUID(),nonce:randomUUID(),boot:randomUUID(),
  home:{homeId:`chat-${randomUUID()}`,homeKey:randomUUID().replaceAll('-','').repeat(2),configDigest:'a'.repeat(64),provider:'codex',account:'team1',repo:'perfectuser21/cecelia',profile}};
 await transaction(async db=>{
  await db.query("INSERT INTO tasks(id,status) VALUES($1,'in_progress')",[row.task]);
  await db.query(`INSERT INTO app_server_authorizations(id,machine_registry_id,node_version_id,grant_id,evidence_task_id,home,worker_id,worker_boot_id,nonce,challenge_expires_at,authorization_expires_at)
   SELECT $1,machine_registry_id,$2,$3,$4,$5,'xian-mac-m1',$6,$7,statement_timestamp()+$8::interval,statement_timestamp()+interval '24 hours' FROM execution_node_versions WHERE id=$2`,
  [row.id,version,row.grant,row.task,row.home,row.boot,row.nonce,challenge]);
  await db.query(`INSERT INTO execution_grants(id,node_version_id,surface,provider,account_id,repo_scope,profile_id,provenance,evidence_task_id,state,expires_at)
   SELECT grant_id,node_version_id,'app_server','codex','team1',ARRAY['perfectuser21/cecelia'],$2,'app_server_canary',evidence_task_id,'pending',authorization_expires_at FROM app_server_authorizations WHERE id=$1`,[row.id,profile]);
 });return row;
}
async function accept(db,row){
 await db.query("UPDATE app_server_authorizations SET state='accepted',evidence=$2,accepted_at=clock_timestamp() WHERE id=$1",[row.id,{nonce:row.nonce,worker_boot_id:row.boot,config_digest:row.home.configDigest,cleanup_confirmed:true}]);
}
it('pending不能激活；缺少任务完成留痕时整笔事务回滚',async()=>{
 const row=await prepared();
 await expect(pool.query("UPDATE execution_grants SET state='active' WHERE id=$1",[row.grant])).rejects.toThrow('appserver_evidence_required');
 await expect(transaction(async db=>{await accept(db,row);await db.query("UPDATE execution_grants SET state='active' WHERE id=$1",[row.grant]);})).rejects.toThrow('appserver_evidence_required');
 expect((await pool.query('SELECT state,evidence FROM app_server_authorizations WHERE id=$1',[row.id])).rows[0]).toEqual({state:'prepared',evidence:null});
});
it('证据绑定nonce和boot，验收身份与期限不可改写',async()=>{
 const row=await prepared();
 await expect(pool.query("UPDATE app_server_authorizations SET state='accepted',evidence=$2,accepted_at=clock_timestamp() WHERE id=$1",[row.id,{nonce:row.nonce,worker_boot_id:randomUUID(),config_digest:row.home.configDigest,cleanup_confirmed:true}])).rejects.toThrow('check constraint');
 for(const sql of ["nonce=gen_random_uuid()","worker_boot_id=gen_random_uuid()","authorization_expires_at=authorization_expires_at+interval '1 hour'","home=jsonb_set(home,'{profile}','\"other\"')"]){
  await expect(pool.query(`UPDATE app_server_authorizations SET ${sql} WHERE id=$1`,[row.id])).rejects.toThrow('appserver_authorization_history_immutable');
 }
});
it('同tuple只有一份活授权；撤销后可建立新证据，旧授权不可复活',async()=>{
 const row=await prepared();
 await expect(prepared(row.home.profile)).rejects.toThrow('execution_live_chat_grant_identity');
 await transaction(async db=>{await accept(db,row);await db.query("UPDATE tasks SET status='completed' WHERE id=$1",[row.task]);await db.query("UPDATE execution_grants SET state='active' WHERE id=$1",[row.grant]);await db.query("UPDATE app_server_authorizations SET state='active',activated_at=clock_timestamp() WHERE id=$1",[row.id]);});
 await pool.query("UPDATE execution_grants SET state='revoked' WHERE id=$1",[row.grant]);
 await pool.query("UPDATE app_server_authorizations SET state='revoked' WHERE id=$1",[row.id]);
 const next=await prepared(row.home.profile);expect(next.grant).not.toBe(row.grant);
 await expect(pool.query("UPDATE execution_grants SET state='active' WHERE id=$1",[row.grant])).rejects.toThrow('appserver_grant_history_immutable');
 await expect(pool.query("UPDATE app_server_authorizations SET state='accepted' WHERE id=$1",[row.id])).rejects.toThrow('appserver_authorization_history_immutable');
 await expect(pool.query('DELETE FROM app_server_authorizations WHERE id=$1',[row.id])).rejects.toThrow('appserver_authorization_history_immutable');
 expect((await pool.query('SELECT state FROM execution_grants WHERE id=$1',[row.grant])).rows[0].state).toBe('revoked');
});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});
it('Mac legacy版本不能绕过验收直接激活聊天授权，原18+2保持不变',async()=>{
 const query=pool.query("INSERT INTO execution_grants(node_version_id,surface,provider,account_id,repo_scope,profile_id,provenance,state) VALUES($1,'app_server','codex','team1',ARRAY['perfectuser21/cecelia'],'chat','legacy_policy','active')",[version]);
 await expect(query).rejects.toThrow('appserver_authorization_required');
 expect((await pool.query("SELECT count(*)::int AS n FROM execution_grants WHERE surface IN ('harness','legacy_executor')")).rows[0].n).toBe(20);
});

it('挑战过期后不能接受证据或激活',async()=>{
 const row=await prepared(undefined,'100 milliseconds');await new Promise(r=>setTimeout(r,150));
 await expect(transaction(async db=>{await accept(db,row);await db.query("UPDATE tasks SET status='completed' WHERE id=$1",[row.task]);await db.query("UPDATE execution_grants SET state='active' WHERE id=$1",[row.grant]);await db.query("UPDATE app_server_authorizations SET state='active',activated_at=clock_timestamp() WHERE id=$1",[row.id]);})).rejects.toThrow('appserver_canary_expired');
 expect((await pool.query('SELECT state FROM app_server_authorizations WHERE id=$1',[row.id])).rows[0].state).toBe('prepared');
});
it('不能只撤销验收记录却留下活grant；同事务一致撤销才提交',async()=>{
 const row=await prepared();await transaction(async db=>{await accept(db,row);await db.query("UPDATE tasks SET status='completed' WHERE id=$1",[row.task]);await db.query("UPDATE execution_grants SET state='active' WHERE id=$1",[row.grant]);await db.query("UPDATE app_server_authorizations SET state='active',activated_at=clock_timestamp() WHERE id=$1",[row.id]);});
 await expect(pool.query("UPDATE app_server_authorizations SET state='revoked' WHERE id=$1",[row.id])).rejects.toThrow('appserver_authorization_state_mismatch');
 await transaction(async db=>{await db.query("UPDATE app_server_authorizations SET state='revoked' WHERE id=$1",[row.id]);await db.query("UPDATE execution_grants SET state='revoked' WHERE id=$1",[row.grant]);});
 expect((await pool.query('SELECT state FROM execution_grants WHERE id=$1',[row.grant])).rows[0].state).toBe('revoked');
});
it('不能提前单独激活记录来跨过grant首次激活时限',async()=>{
 const row=await prepared(undefined,'200 milliseconds');
 await expect(transaction(async db=>{await accept(db,row);await db.query("UPDATE app_server_authorizations SET state='active',activated_at=clock_timestamp() WHERE id=$1",[row.id]);})).rejects.toThrow('appserver_authorization_state_mismatch');
 await transaction(async db=>{await accept(db,row);await db.query("UPDATE tasks SET status='completed' WHERE id=$1",[row.task]);});
 await new Promise(r=>setTimeout(r,250));
 await expect(pool.query("UPDATE execution_grants SET state='active' WHERE id=$1",[row.grant])).rejects.toThrow('appserver_canary_expired');
});
it('受信prepare并发幂等，自动登记验收任务；revoke不依赖在线Worker',async()=>{
 let api={};try{api=await import('../../authorization-store.js');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
 expect(api.createAuthorizationStore).toBeTypeOf('function');
 const home={homeId:`chat-${randomUUID()}`,homeKey:randomUUID().replaceAll('-','').repeat(2),configDigest:'a'.repeat(64),provider:'codex',account:'team1',repo:'perfectuser21/cecelia',profile:`chat-${randomUUID()}`};
 const node=(await pool.query('SELECT machine_registry_id FROM execution_node_versions WHERE id=$1',[version])).rows[0];
 const boot=randomUUID();let offline=false;
 const store=api.createAuthorizationStore({pool,homes:{[home.homeId]:home},client:{async probeCapabilities(){if(offline)throw Error('offline');return {machine_id:'xian-mac-m1',worker_id:'xian-mac-m1',worker_boot_id:boot,profiles:{[home.profile]:home.configDigest}};}},
  createTask:async({db})=>({success:true,task:(await db.query("INSERT INTO tasks(id,status) VALUES($1,'in_progress') RETURNING *",[randomUUID()])).rows[0]})});
 const input={home_id:home.homeId,machine_registry_id:node.machine_registry_id,expected_version_id:version};
 const [a,b]=await Promise.all([store.prepare(input),store.prepare(input)]);expect(a.id).toBe(b.id);expect(a.state).toBe('prepared');
 expect((await pool.query('SELECT state FROM execution_grants WHERE id=$1',[a.grant_id])).rows[0].state).toBe('pending');
 expect((await pool.query('SELECT status FROM tasks WHERE id=$1',[a.evidence_task_id])).rows[0].status).toBe('in_progress');
 await expect(store.prepare({...input,endpoint:'http://arbitrary'})).rejects.toThrow('appserver_authorization_request_invalid');
 offline=true;await store.revoke(a.id);
 expect((await pool.query('SELECT state FROM app_server_authorizations WHERE id=$1',[a.id])).rows[0].state).toBe('revoked');
 expect((await pool.query('SELECT state FROM execution_grants WHERE id=$1',[a.grant_id])).rows[0].state).toBe('revoked');
});
