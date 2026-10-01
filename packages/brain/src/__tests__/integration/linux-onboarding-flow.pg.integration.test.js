import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {it,expect,beforeAll,afterAll,beforeEach} from 'vitest';
import {DB_DEFAULTS} from '../../db-config.js';
import {createLinuxOnboardingFlow} from '../../linux-pool/onboarding-flow.js';
import {projectLinuxExecution} from '../../linux-pool/onboarding-projection.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
const database=process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname.slice(1):DB_DEFAULTS.database;
if(database!=='cecelia_scratch'&&!(process.env.CI&&database==='cecelia_test'))throw Error('local scratch only');
const schema='linux_onboard_'+randomUUID().replaceAll('-',''),admin=new pg.Client(options),pool=new pg.Pool({...options,options:`-c search_path=${schema},public`});
let machine,parent;
beforeAll(async()=>{await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);await pool.query(`CREATE TABLE tasks(id UUID PRIMARY KEY,title TEXT,task_type TEXT,status TEXT,payload JSONB,result JSONB,parent_task_id UUID,claimed_by TEXT,claimed_at TIMESTAMPTZ,started_at TIMESTAMPTZ,updated_at TIMESTAMPTZ DEFAULT now(),created_at TIMESTAMPTZ DEFAULT now(),completed_at TIMESTAMPTZ);
 CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,name TEXT,status TEXT,metadata JSONB,updated_at TIMESTAMPTZ DEFAULT now());
 CREATE TABLE execution_nodes(machine_registry_id UUID PRIMARY KEY,current_version_id UUID);
 CREATE TABLE execution_node_versions(id uuid PRIMARY KEY,state text);
 CREATE TABLE execution_grants(id uuid PRIMARY KEY,node_version_id uuid,state text,expires_at timestamptz,surface text,provider text,profile_id text);
 CREATE TABLE linux_script_authorizations(id UUID PRIMARY KEY,machine_registry_id UUID,execution_version_id UUID,state TEXT,authorization_expires_at TIMESTAMPTZ,grant_ids jsonb);
 CREATE FUNCTION fixture_grants() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE grant_id uuid:=gen_random_uuid(); BEGIN
 INSERT INTO execution_node_versions VALUES(NEW.execution_version_id,'active');
 INSERT INTO execution_grants VALUES(grant_id,NEW.execution_version_id,'active',NEW.authorization_expires_at,'managed_script','script','shell');
 NEW.grant_ids:=jsonb_build_object('shell',grant_id);RETURN NEW;END $$;
 CREATE TRIGGER fixture_grants BEFORE INSERT ON linux_script_authorizations FOR EACH ROW EXECUTE FUNCTION fixture_grants();`);});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{await pool.query('TRUNCATE tasks,system_registry,execution_nodes,linux_script_authorizations,execution_node_versions,execution_grants');parent=randomUUID();machine={id:randomUUID(),name:'new-linux',metadata:{role:'worker',node_health:{os:'linux'},onboarding:{request:{name:'new-linux',address:'100.64.0.2',ssh_user:'root',ssh_port:22,credential_ref:'op://CS/test/private key',host_key_fingerprint:'SHA256:'+'a'.repeat(43),role:'worker',region:'HK'}}}};
 machine.metadata.onboarding.id=machine.id;
 await pool.query("INSERT INTO tasks(id,status,payload) VALUES($1,'completed',$2)",[parent,{node_onboarding:{id:machine.metadata.onboarding.id,request:machine.metadata.onboarding.request}}]);
 await pool.query("INSERT INTO system_registry(id,type,name,status,metadata) VALUES($1,'machine',$2,'active',$3)",[machine.id,machine.name,machine.metadata]);});
const createTask=async args=>({success:true,task:(await args.db.query('INSERT INTO tasks(id,title,task_type,status,payload,parent_task_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[randomUUID(),args.title,args.task_type,args.status,args.payload,args.parent_task_id])).rows[0]});
const flow=extra=>createLinuxOnboardingFlow({pool,createTask,revision:'a'.repeat(40),afterTerminal:async()=>{},...extra});
it('并发只登记一个内部接入子任务，nonce/intent服务端生成且observer不登记',async()=>{
 const f=flow({step:async()=>{}});const results=await Promise.all([f.ensure(machine,parent),f.ensure(machine,parent)]);expect(results[0]).toBe(results[1]);
 const rows=(await pool.query("SELECT * FROM tasks WHERE payload ? 'linux_onboarding'")).rows;expect(rows).toHaveLength(1);expect(rows[0].parent_task_id).toBe(parent);
 expect(rows[0].payload.linux_onboarding).toMatchObject({phase:'probe',nonce:expect.stringMatching(/^[a-f0-9]{64}$/),intent_id:expect.any(String)});
 expect(await f.ensure({...machine,metadata:{...machine.metadata,role:'observer'}},parent)).toBe(null);
});
it('会话锁覆盖外部副作用；阶段先落库，未知保留同intent，重试不重建任务',async()=>{
 let calls=0,release;const wait=new Promise(r=>{release=r;});
 const f=flow({step:async(_task,_machine,s,save)=>{calls++;await save({...s,phase:'bootstrap'});await wait;throw Error('private-secret');}});
 const id=await f.ensure(machine,parent),first=f.advance(id);while(calls===0)await new Promise(r=>setTimeout(r,5));
 expect(await f.advance(id)).toMatchObject({busy:true});release();await first;
 const row=(await pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];expect(row.payload.linux_onboarding.phase).toBe('bootstrap');expect(JSON.stringify(row)).not.toContain('private-secret');
 await f.retry(id);expect((await pool.query("SELECT id FROM tasks WHERE payload ? 'linux_onboarding'")).rows).toHaveLength(1);expect(calls).toBe(1);
});
it('仅当前未过期active授权才能完成接入任务并写事实证据actor；失效界面回到续验中',async()=>{
 const version=randomUUID(),runtime=randomUUID();const f=flow({step:async(_t,_m,s,save)=>save({...s,phase:'active',runtime_json:JSON.stringify({id:runtime}),active:{execution:true,execution_version_id:version,expires_at:new Date(Date.now()+86400000).toISOString()}})});
 const id=await f.ensure(machine,parent);await pool.query('INSERT INTO execution_nodes VALUES($1,$2)',[machine.id,version]);await pool.query("INSERT INTO linux_script_authorizations(id,machine_registry_id,execution_version_id,state,authorization_expires_at) VALUES($1,$2,$3,'active',now()+interval '24 hours')",[runtime,machine.id,version]);
 await f.advance(id);const task=(await pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];expect(task.status).toBe('completed');expect(task.result).toMatchObject({fact:expect.any(String),actor:'linux-pool-onboarding',evidence:{runtime_id:runtime,execution_version_id:version}});
 expect((await f.view(id)).execution).toBe(true);await pool.query("UPDATE linux_script_authorizations SET authorization_expires_at=now()-interval '1 second'");
 expect(await f.view(id)).toMatchObject({execution:false,phase:'renewal'});
});
it('可编辑设备请求和执行能力不会替代原登记请求或内部身份验收',async()=>{
 let received;const f=flow({step:async(_t,m)=>{received=m;}}),id=await f.ensure(machine,parent);
 await pool.query("UPDATE system_registry SET metadata=jsonb_set(jsonb_set(metadata,'{onboarding,request,address}','\"attacker.invalid\"'),'{node_health,capabilities}','{\"execution\":true}')");
 await f.advance(id);expect(received.metadata.onboarding.request.address).toBe('100.64.0.2');
 expect((await projectLinuxExecution(pool,[machine]))[0].execution.enabled).toBe(false);
});
it('卡片状态绑定当前许可、内部fresh身份及最新接入任务，registry伪造无效',async()=>{
 const version=randomUUID(),runtime=randomUUID();const f=flow({step:async(_t,_m,s,save)=>save({...s,phase:'active',runtime_json:JSON.stringify({id:runtime})})});
 const id=await f.ensure(machine,parent);await pool.query('INSERT INTO execution_nodes VALUES($1,$2)',[machine.id,version]);await pool.query("INSERT INTO linux_script_authorizations(id,machine_registry_id,execution_version_id,state,authorization_expires_at) VALUES($1,$2,$3,'active',now()+interval '24 hours')",[runtime,machine.id,version]);await f.advance(id);
 expect((await projectLinuxExecution(pool,[machine]))[0].execution.enabled).toBe(true);
 await pool.query("UPDATE tasks SET payload=jsonb_set(payload,'{linux_onboarding,identity_ok}','false') WHERE id=$1",[id]);
 expect((await projectLinuxExecution(pool,[machine]))[0].execution.enabled).toBe(false);
});
it('续验不依赖设备metadata中的可编辑任务指针',async()=>{
 const version=randomUUID(),runtime=randomUUID(),boot=randomUUID(),f=flow({checkIdentity:async()=>({worker_boot_id:boot}),step:async(_t,_m,s,save)=>save({...s,phase:'active',
  installation_json:JSON.stringify({receipt:{worker_boot_id:boot}}),runtime_json:JSON.stringify({id:runtime}),active:{execution_version_id:version}})});
 const id=await f.ensure(machine,parent);await pool.query('INSERT INTO execution_nodes VALUES($1,$2)',[machine.id,version]);await pool.query("INSERT INTO linux_script_authorizations(id,machine_registry_id,execution_version_id,state,authorization_expires_at) VALUES($1,$2,$3,'active',now()+interval '30 minutes')",[runtime,machine.id,version]);await f.advance(id);
 await pool.query("UPDATE tasks SET payload=jsonb_set(payload,'{linux_onboarding,identity_checked_at}','\"2000-01-01T00:00:00Z\"') WHERE id=$1",[id]);
 await pool.query("UPDATE system_registry SET metadata=jsonb_set(metadata,'{onboarding,execution_task_id}',$1::jsonb)",[JSON.stringify(randomUUID())]);
 expect(await f.renew()).toEqual(expect.any(String));
});
it.each(['expiry','boot'])('%s自动生成唯一下一棒，保留已完成历史及凭据/安装intent',async kind=>{
 const version=randomUUID(),runtime=randomUUID(),boot=randomUUID();const f=flow({checkIdentity:async()=>({worker_boot_id:kind==='boot'?randomUUID():boot}),step:async(_t,_m,s,save)=>save({...s,phase:'active',
  installation_json:JSON.stringify({receipt:{worker_boot_id:boot}}),runtime_json:JSON.stringify({id:runtime}),active:{execution:true,execution_version_id:version}})});
 const id=await f.ensure(machine,parent);await pool.query('INSERT INTO execution_nodes VALUES($1,$2)',[machine.id,version]);
 await pool.query("INSERT INTO linux_script_authorizations(id,machine_registry_id,execution_version_id,state,authorization_expires_at) VALUES($1,$2,$3,'active',now()+$4::interval)",[runtime,machine.id,version,kind==='expiry'?'30 minutes':'24 hours']);await f.advance(id);
 await pool.query("UPDATE tasks SET payload=jsonb_set(payload,'{linux_onboarding,identity_checked_at}','\"2000-01-01T00:00:00Z\"') WHERE payload ? 'linux_onboarding'");
 await Promise.all([f.renew(),f.renew()]);const rows=(await pool.query("SELECT * FROM tasks WHERE payload ? 'linux_onboarding' ORDER BY created_at")).rows;
 expect(rows).toHaveLength(2);expect(rows[0].status).toBe('completed');expect(rows[1].parent_task_id).toBe(id);
 expect(rows[1].payload.linux_onboarding).toMatchObject({phase:'renew_revoke',previous_runtime_id:runtime,intent_id:rows[0].payload.linux_onboarding.intent_id});
 expect(rows[1].payload.linux_onboarding.nonce).not.toBe(rows[0].payload.linux_onboarding.nonce);
});
it('显式撤销不会被后台续验自动重新授权',async()=>{
 const version=randomUUID(),runtime=randomUUID(),boot=randomUUID(),f=flow({checkIdentity:async()=>({worker_boot_id:boot}),step:async(_t,_m,s,save)=>save({...s,phase:'active',
  installation_json:JSON.stringify({receipt:{worker_boot_id:boot}}),runtime_json:JSON.stringify({id:runtime}),active:{execution:true,execution_version_id:version}})});
 const id=await f.ensure(machine,parent);await pool.query('INSERT INTO execution_nodes VALUES($1,$2)',[machine.id,version]);await pool.query("INSERT INTO linux_script_authorizations(id,machine_registry_id,execution_version_id,state,authorization_expires_at) VALUES($1,$2,$3,'active',now()+interval '24 hours')",[runtime,machine.id,version]);await f.advance(id);
 await pool.query("UPDATE linux_script_authorizations SET state='revoked'");await pool.query("UPDATE tasks SET payload=jsonb_set(payload,'{linux_onboarding,identity_checked_at}','\"2000-01-01T00:00:00Z\"') WHERE payload ? 'linux_onboarding'");
 expect(await f.renew()).toBe(null);expect((await pool.query("SELECT id FROM tasks WHERE payload ? 'linux_onboarding'")).rows).toHaveLength(1);
 expect(await f.view(id)).toMatchObject({execution:false,phase:'revoked'});
});

it.each(['grant_revoke','grant_expiry','version_revoke'])('%s后接入视图与机器卡片都不能假报执行已启用',async kind=>{
 const version=randomUUID(),runtime=randomUUID(),f=flow({step:async(_t,_m,s,save)=>save({...s,phase:'active',runtime_json:JSON.stringify({id:runtime})})});
 const id=await f.ensure(machine,parent);await pool.query('INSERT INTO execution_nodes VALUES($1,$2)',[machine.id,version]);
 await pool.query("INSERT INTO linux_script_authorizations(id,machine_registry_id,execution_version_id,state,authorization_expires_at) VALUES($1,$2,$3,'active',now()+interval '24 hours')",[runtime,machine.id,version]);await f.advance(id);
 if(kind==='version_revoke')await pool.query("UPDATE execution_node_versions SET state='revoked'");
 else if(kind==='grant_revoke')await pool.query("UPDATE execution_grants SET state='revoked'");
 else await pool.query("UPDATE execution_grants SET expires_at=now()-interval '1 second'");
 expect((await f.view(id)).execution).toBe(false);expect((await projectLinuxExecution(pool,[machine]))[0].execution.enabled).toBe(false);
 if(kind!=='grant_expiry'){
  await pool.query("UPDATE tasks SET payload=jsonb_set(payload,'{linux_onboarding,identity_checked_at}','\"2000-01-01T00:00:00Z\"') WHERE id=$1",[id]);
  expect(await f.renew()).toBe(null);expect(await f.view(id)).toMatchObject({phase:'revoked',execution:false});
 }
});
