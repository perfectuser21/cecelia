import {it,expect,beforeAll,afterAll,beforeEach} from 'vitest';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {projectLinuxExecution} from '../../linux-pool/onboarding-projection.js';
import {LIVE_RUNTIME_GRANTS_SQL} from '../../linux-pool/active-grants.js';
import {US_SCHEDULER_ID} from '../../linux-pool/deployment.js';
import {DB_DEFAULTS} from '../../db-config.js';
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
const database=process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname.slice(1):DB_DEFAULTS.database;
if(database!=='cecelia_scratch'&&!(process.env.CI&&database==='cecelia_test'))throw Error('local scratch only');
const schema='projection_'+randomUUID().replaceAll('-',''),admin=new pg.Client(options),pool=new pg.Pool({...options,options:`-c search_path=${schema},public`});
// 原e3a/5853 SQL仅作隔离数据库的等价对照，永不提交至生产。
const ORIGINAL_SQL=`SELECT a.machine_registry_id,a.authorization_expires_at,
  LEAST(a.authorization_expires_at,(t.payload->'linux_onboarding'->>'identity_checked_at')::timestamptz+interval '3 minutes') AS verified_until FROM linux_script_authorizations a
  JOIN execution_nodes n ON n.machine_registry_id=a.machine_registry_id AND n.current_version_id=a.execution_version_id
  JOIN system_registry r ON r.id=a.machine_registry_id
  JOIN tasks t ON t.payload->'linux_onboarding'->>'machine_registry_id'=a.machine_registry_id::text
   AND ((t.payload->'linux_onboarding'->>'runtime_json')::jsonb->>'id')=a.id::text
  JOIN tasks source ON source.id::text=t.payload->'linux_onboarding'->>'parent_task_id'
  WHERE a.machine_registry_id=ANY($1::uuid[]) AND a.machine_registry_id<>$2 AND a.state='active'
   AND ${LIVE_RUNTIME_GRANTS_SQL}
   AND source.payload->'node_onboarding'->'request'->>'role'='worker' AND COALESCE(source.payload->'node_onboarding'->>'execution_revoked','false')<>'true'
   AND COALESCE(t.payload->'linux_onboarding'->>'revoked','false')<>'true'
   AND a.authorization_expires_at>clock_timestamp() AND r.status='active' AND r.metadata->>'role'='worker'
   AND COALESCE(r.metadata->>'scheduler_only','false')<>'true' AND t.status='completed' AND t.result->>'actor'='linux-pool-onboarding'
   AND t.payload->'linux_onboarding'->>'phase'='active' AND t.payload->'linux_onboarding'->>'identity_ok'='true'
   AND (t.payload->'linux_onboarding'->>'identity_checked_at')::timestamptz>clock_timestamp()-interval '3 minutes'
   AND NOT EXISTS(SELECT 1 FROM tasks newer WHERE newer.payload->'linux_onboarding'->>'machine_registry_id'=a.machine_registry_id::text
    AND (newer.created_at,newer.id)>(t.created_at,t.id))`;
let machine,ids;
beforeAll(async()=>{await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);await pool.query(`
 CREATE TABLE tasks(id uuid PRIMARY KEY,payload jsonb,result jsonb,status text,created_at timestamptz DEFAULT now());
 CREATE INDEX idx_tasks_status ON tasks(status);CREATE INDEX idx_tasks_created_at ON tasks(created_at);
 CREATE TABLE system_registry(id uuid PRIMARY KEY,status text,metadata jsonb);
 CREATE TABLE execution_nodes(machine_registry_id uuid PRIMARY KEY,current_version_id uuid);
 CREATE TABLE execution_node_versions(id uuid PRIMARY KEY,state text);
 CREATE TABLE linux_script_authorizations(id uuid PRIMARY KEY,machine_registry_id uuid,execution_version_id uuid,state text,authorization_expires_at timestamptz,grant_ids jsonb);
 CREATE TABLE execution_grants(id uuid PRIMARY KEY,node_version_id uuid,profile_id text,surface text,provider text,state text,expires_at timestamptz);
 `);});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{
 await pool.query('TRUNCATE tasks,system_registry,execution_nodes,execution_node_versions,linux_script_authorizations,execution_grants');
 ids={machine:randomUUID(),version:randomUUID(),runtime:randomUUID(),grant:randomUUID(),source:randomUUID(),task:randomUUID()};
 machine={id:ids.machine,metadata:{onboarding:{}}};
 await pool.query(`INSERT INTO system_registry VALUES($1,'active','{"role":"worker"}');`,[ids.machine]);
 await pool.query(`INSERT INTO execution_nodes VALUES($1,$2)`,[ids.machine,ids.version]);
 await pool.query(`INSERT INTO execution_node_versions VALUES($1,'active')`,[ids.version]);
 await pool.query(`INSERT INTO linux_script_authorizations VALUES($1,$2,$3,'active',clock_timestamp()+interval '1 hour',$4)`,[ids.runtime,ids.machine,ids.version,JSON.stringify({fixture:ids.grant})]);
 await pool.query(`INSERT INTO execution_grants VALUES($1,$2,'fixture','managed_script','script','active',clock_timestamp()+interval '1 hour')`,[ids.grant,ids.version]);
 await pool.query(`INSERT INTO tasks VALUES($1,'{"node_onboarding":{"request":{"role":"worker"}}}',NULL,'completed',clock_timestamp()-interval '1 hour')`,[ids.source]);
 await pool.query(`INSERT INTO tasks VALUES($1,$2,'{"actor":"linux-pool-onboarding"}','completed',clock_timestamp()-interval '1 minute')`,[ids.task,JSON.stringify({linux_onboarding:{machine_registry_id:ids.machine,parent_task_id:ids.source,runtime_json:JSON.stringify({id:ids.runtime}),phase:'active',identity_ok:'true',identity_checked_at:new Date().toISOString()}})]);
});
const actual=async(m=machine)=>(await projectLinuxExecution(pool,[m]))[0].execution;
async function equivalent(expected,m=machine){
 const old=(await pool.query(ORIGINAL_SQL,[[m.id],US_SCHEDULER_ID])).rows;
 const value=await actual(m);expect(value.enabled).toBe(expected);expect(value.enabled).toBe(old.some(r=>r.machine_registry_id===m.id));
 if(expected){expect(value.expires_at).toEqual(old[0].authorization_expires_at);expect(value.verified_until).toEqual(old[0].verified_until);}
}
it('稀疏单machine在大量无关completed任务下仍真实返回有效许可，不能用查询失败降级假装快',async()=>{
 await pool.query(`INSERT INTO tasks SELECT md5('noise-'||i)::uuid,jsonb_build_object('linux_onboarding',jsonb_build_object('machine_registry_id',md5('foreign-'||i)::uuid::text,'parent_task_id',md5('source-'||i)::uuid::text,'runtime_json','{"id":"noise"}','phase','active','identity_ok','true','identity_checked_at',clock_timestamp()::text)), '{"actor":"linux-pool-onboarding"}','completed',clock_timestamp()-interval '2 minutes' FROM generate_series(1,30000) i`);
 await pool.query('ANALYZE tasks');
 let currentSql,parameters;const observed={query:async(sql,params)=>{currentSql=sql;parameters=params;return pool.query(sql,params);}};
 expect((await projectLinuxExecution(observed,[machine]))[0].execution.enabled).toBe(true);
 const plan=(await pool.query('EXPLAIN (FORMAT JSON) '+currentSql,parameters)).rows[0]['QUERY PLAN'][0].Plan;
 const allPlans=node=>[node,...(node.Plans??[]).flatMap(allPlans)];
 // 一个目标task来源扫描加原canonical parent读取；newer不应再扫描整张任务真表。
 expect(allPlans(plan).filter(node=>node['Relation Name']==='tasks').length).toBeLessThanOrEqual(2);
 const c=await pool.connect();try{await c.query('SET statement_timeout=250');const result=await projectLinuxExecution(c,[machine]);expect(result[0].execution.enabled).toBe(true);}finally{await c.query('RESET statement_timeout');c.release();}
});
it('有效许可输出与原SQL完全一致；输入UUID大小写保原投影结果',async()=>{await equivalent(true);await equivalent(false,{...machine,id:machine.id.toUpperCase()});});
it.each(['failed','queued','revoked','pending'])('任意较新%s任务压住旧active许可',async state=>{
 await pool.query(`INSERT INTO tasks VALUES($1,$2,NULL,$3,clock_timestamp())`,[randomUUID(),JSON.stringify({linux_onboarding:{machine_registry_id:ids.machine,phase:state}}),state]);await equivalent(false);
});
it('同timestamp UUID更大的任务仍压旧；NULL timestamp保原三值比较',async()=>{
 await pool.query(`UPDATE tasks SET created_at='2026-01-01',id='11111111-1111-1111-1111-111111111111' WHERE id=$1`,[ids.task]);
 await pool.query(`INSERT INTO tasks VALUES('ffffffff-ffff-ffff-ffff-ffffffffffff',$1,NULL,'failed','2026-01-01')`,[JSON.stringify({linux_onboarding:{machine_registry_id:ids.machine}})]);await equivalent(false);
 await pool.query(`UPDATE tasks SET created_at=NULL WHERE id='ffffffff-ffff-ffff-ffff-ffffffffffff'`);await equivalent(true);
});
it.each(['upper-machine','foreign-machine','runtime','parent-missing','parent-upper','source-role','source-revoked','identity-false','identity-stale','phase','actor','task-status'])('原task与source精确身份判据保留:%s',async kind=>{
 const replacements={ 'upper-machine':['machine_registry_id',ids.machine.toUpperCase()],'foreign-machine':['machine_registry_id',randomUUID()],runtime:['runtime_json',JSON.stringify({id:randomUUID()})],'parent-missing':['parent_task_id',randomUUID()],'parent-upper':['parent_task_id',ids.source.toUpperCase()],'identity-false':['identity_ok','false'],'identity-stale':['identity_checked_at','2000-01-01T00:00:00Z'],phase:['phase','pending']};
 if(replacements[kind]){const [key,value]=replacements[kind];await pool.query(`UPDATE tasks SET payload=jsonb_set(payload,ARRAY['linux_onboarding',$2],to_jsonb($3::text)) WHERE id=$1`,[ids.task,key,value]);}
 else if(kind==='source-role')await pool.query(`UPDATE tasks SET payload='{"node_onboarding":{"request":{"role":"scheduler_only"}}}' WHERE id=$1`,[ids.source]);
 else if(kind==='source-revoked')await pool.query(`UPDATE tasks SET payload=jsonb_set(payload,'{node_onboarding,execution_revoked}','true') WHERE id=$1`,[ids.source]);
 else if(kind==='actor')await pool.query(`UPDATE tasks SET result='{"actor":"forged"}' WHERE id=$1`,[ids.task]);
 else await pool.query(`UPDATE tasks SET status='failed' WHERE id=$1`,[ids.task]);
 await equivalent(false);
});
it.each(['version-current','version-state','auth-revoked','auth-expired','grant-profile','grant-provider','grant-surface','grant-state','grant-expired','grant-empty','registry-role','registry-status','scheduler-only'])('原授权链判据保留:%s',async kind=>{
 const statements={
 'version-current':`UPDATE execution_nodes SET current_version_id='00000000-0000-0000-0000-000000000000'`,
 'version-state':`UPDATE execution_node_versions SET state='revoked'`,
 'auth-revoked':`UPDATE linux_script_authorizations SET state='revoked'`,
 'auth-expired':`UPDATE linux_script_authorizations SET authorization_expires_at=clock_timestamp()-interval '1 second'`,
 'grant-profile':`UPDATE execution_grants SET profile_id='other'`,
 'grant-provider':`UPDATE execution_grants SET provider='other'`,
 'grant-surface':`UPDATE execution_grants SET surface='other'`,
 'grant-state':`UPDATE execution_grants SET state='revoked'`,
 'grant-expired':`UPDATE execution_grants SET expires_at=clock_timestamp()-interval '1 second'`,
 'grant-empty':`UPDATE linux_script_authorizations SET grant_ids='{}'`,
 'registry-role':`UPDATE system_registry SET metadata='{"role":"scheduler_only"}'`,
 'registry-status':`UPDATE system_registry SET status='inactive'`,
 'scheduler-only':`UPDATE system_registry SET metadata='{"role":"worker","scheduler_only":true}'`};
 await pool.query(statements[kind]);await equivalent(false);
});
