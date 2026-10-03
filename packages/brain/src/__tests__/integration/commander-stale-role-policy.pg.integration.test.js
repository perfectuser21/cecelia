/** Real PostgreSQL scanner/CAS and local subprocess cron fixture; no SSH/Bark/production. */
import {describe,it,expect} from 'vitest';import pg from 'pg';import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {DB_DEFAULTS} from '../../db-config.js';
import {runCommanderWatchdog,recordCommanderHeartbeat} from '../../commander-watchdog.js';
const execute=promisify(execFile),OLD='11111111-1111-4111-8111-111111111111',NEW='22222222-2222-4222-8222-222222222222';
const ctx={tag:'stale_policy_fixture',host:'xian-m4',serial:'S1',profile:'legacy',cap:'keyword_acquisition'},NAME='escort-'+ctx.host+'-'+ctx.tag;
const job=id=>({id,name:NAME,agentId:'work-commander',sessionTarget:'session:'+NAME,enabled:id===NEW,schedule:{kind:'every',everyMs:600000},delivery:{mode:'none'},state:{}});
const program=`const fs=require('node:fs'),p=process.env.CRON_STATE,s=JSON.parse(fs.readFileSync(p)),cmd=process.argv[2],op=/^openclaw cron (list|add|rm|run)\\b/.exec(cmd)?.[1];if(!op)throw Error('unexpected mock command');s.calls.push(op);if(op==='rm'){if(!cmd.includes(s.jobs[0]?.id||'never'))throw Error('wrong rm');s.jobs=[];}if(op==='add'){s.adds++;s.jobs=[s.next];}fs.writeFileSync(p,JSON.stringify(s));if(op==='add'&&s.unknown)console.log('unknown-response');else console.log(JSON.stringify(op==='add'?{id:s.next.id}:{jobs:s.jobs}));`;
async function createFixtureSchema(admin,schema,githubActions){
 const {rows:[actual]}=await admin.query('SELECT current_database() db');
 if(actual.db!=='cecelia_scratch'&&!(githubActions==='true'&&actual.db==='cecelia_test'))throw Error('fixture_database_not_permitted');
 await admin.query('CREATE SCHEMA '+schema);
}
async function fixture(fn,{young=false,fresh=false,wrong=false,unknown=false,failPatch=false}={}){
 const schema='commander_policy_'+randomUUID().replaceAll('-',''),root=await mkdtemp(join(tmpdir(),'commander-policy-')),state=join(root,'state.json'),bin=join(root,'cron.cjs');
 const admin=new pg.Pool({...DB_DEFAULTS,max:1});try{await createFixtureSchema(admin,schema,process.env.GITHUB_ACTIONS);}catch(error){await admin.end();await rm(root,{recursive:true,force:true});throw error;}
 const pool=new pg.Pool({...DB_DEFAULTS,max:2,options:'-c search_path='+schema});let phases=[];const taskId=randomUUID();
 try{
 await pool.query(`CREATE TABLE tasks(id uuid PRIMARY KEY,title text,task_type text,status text,payload jsonb,started_at timestamptz,due_at timestamptz,created_at timestamptz,updated_at timestamptz);CREATE TABLE working_memory(key text PRIMARY KEY,value_json jsonb);CREATE TABLE task_events(task_id uuid,event_type text,payload jsonb,created_at timestamptz);CREATE TABLE operations(task_id uuid PRIMARY KEY,state text,operation_id text,mode text,previous_id uuid,candidate_id uuid,receipt jsonb,policy text);`);
 const payload={...ctx,source:'cron',escort_id:OLD,commander_adopt_count:0,...fresh?{commander_heartbeat_at:new Date().toISOString()}:{}};
 await pool.query(`INSERT INTO tasks(id,title,task_type,status,payload,started_at,due_at,created_at) VALUES($1,'fixture','device_job','in_progress',$2,NOW()-$3::interval,NULL,NOW()-interval '30 minutes')`,[taskId,payload,young?'5 minutes':'30 minutes']);
 if(failPatch)await pool.query(`CREATE FUNCTION deny_patch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload ? 'commander_handover_operation_id' THEN RAISE EXCEPTION 'test task patch interrupted'; END IF; RETURN NEW;END $$;CREATE TRIGGER deny_patch BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION deny_patch();`);
 await writeFile(bin,program);await writeFile(state,JSON.stringify({jobs:[{...job(OLD),...wrong?{agentId:'foreign'}:{}}],next:job(NEW),adds:0,calls:[],unknown}));
 const command=async remote=>(await execute(process.execPath,[bin,remote],{env:{...process.env,CRON_STATE:state},timeout:5000})).stdout;
 const read=async()=>JSON.parse(await readFile(state));
 const roleHandover=async request=>{
  phases.push(request.phase);let row=(await pool.query('SELECT * FROM operations WHERE task_id=$1',[taskId])).rows[0];
  if(request.phase==='recover')return row?{state:row.state,operationId:row.operation_id,mode:row.mode,previousEscortId:row.previous_id,candidateEscortId:row.candidate_id}: {state:'none'};
  if(request.phase==='prepare'){
   const jobs=JSON.parse(await command('openclaw cron list --all --json')).jobs;
   if(jobs.length!==1||jobs[0].id!==OLD||jobs[0].name!==NAME||jobs[0].agentId!=='work-commander'||jobs[0].sessionTarget!=='session:'+NAME||jobs[0].schedule?.everyMs!==600000)throw Error('wrong actual existing role');
   row=(await pool.query("INSERT INTO operations(task_id,state,operation_id,mode,previous_id,policy) VALUES($1,'prepared',$2,$3,$4,$5) RETURNING *",[taskId,randomUUID(),request.mode,request.previousEscortId,request.existingRolePolicy??null])).rows[0];
  }
  if(request.phase==='observe')row=(await pool.query('UPDATE operations SET state=$2,candidate_id=$3 WHERE task_id=$1 RETURNING *',[taskId,request.addResponse?.error?'pending':'candidate',request.candidateEscortId??null])).rows[0];
  if(request.phase==='commit'){
   const jobs=JSON.parse(await command('openclaw cron list --all --json')).jobs,actual=jobs.filter(j=>j.name===NAME);
   if(actual.length!==1||actual[0].id!==request.candidateEscortId||actual[0].agentId!=='work-commander'||actual[0].sessionTarget!=='session:'+NAME||actual[0].schedule.everyMs!==600000||actual[0].delivery.mode!=='none')throw Error('independent candidate refused');
   const receipt={operationId:row.operation_id,taskId,previousEscortId:row.previous_id,escortId:row.candidate_id,generation:2,...request.context,committedAt:new Date().toISOString(),evidenceRef:'realPG+actual-mockCLI'};
   row=(await pool.query("UPDATE operations SET state='committed',receipt=$3 WHERE task_id=$1 AND operation_id=$2 AND state IN ('candidate','committed') RETURNING *",[taskId,request.operationId,receipt])).rows[0];if(!row)throw Error('operation CAS refused');
  }
  return {state:row.state,operationId:row.operation_id,mode:row.mode,previousEscortId:row.previous_id,candidateEscortId:row.candidate_id,receipt:row.receipt};
 };
 const execFileFn=(file,args,opts,cb)=>{expect(file).toBe('ssh');command(args.at(-1)).then(s=>cb(null,s,''),e=>cb(e,'',e.message));};
 const tick=(extra={})=>runCommanderWatchdog(pool,{roleHandover,execFileFn,bark:async()=>{throw Error('external forbidden');},gateMs:0,...extra});
 await fn({pool,taskId,tick,read,phases,disablePatch:()=>pool.query('DROP TRIGGER deny_patch ON tasks'),payload:async()=>(await pool.query('SELECT payload FROM tasks WHERE id=$1',[taskId])).rows[0].payload});
 }finally{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();await rm(root,{recursive:true,force:true});}
}
describe.skipIf(process.env.POSTGRES_INTEGRATION!=='1')('opt-in stale role realPG/actualCLI',()=>{
 it('replaces disabled actual existing own UUID and persists policy/CAS/payload/event before run',()=>fixture(async f=>{
  const out=await f.tick({existingRolePolicy:'replace-stale-existing'});expect(out.relaunched).toBe(1);expect((await f.read()).adds).toBe(1);expect((await f.read()).calls).toContain('rm');expect((await f.read()).calls.at(-1)).toBe('run');expect(await f.payload()).toMatchObject({escort_id:NEW,commander_adopt_count:0,commander_relaunch_count:1});expect((await f.pool.query('SELECT policy,state FROM operations')).rows[0]).toEqual({policy:'replace-stale-existing',state:'committed'});expect((await f.pool.query("SELECT 1 FROM task_events WHERE event_type='commander_relaunched'")).rowCount).toBe(1);
 }));
 it('undefined policy preserves default two-adopt ceiling before exact replacement',()=>fixture(async f=>{
  for(let count=1;count<=2;count++){expect((await f.tick()).adopted).toBe(1);expect((await f.read()).adds).toBe(0);expect((await f.read()).calls).not.toContain('rm');expect(await f.payload()).toMatchObject({escort_id:OLD,commander_adopt_count:count});await f.pool.query('DELETE FROM operations');await f.pool.query("UPDATE tasks SET payload=payload-'commander_relaunched_at' WHERE id=$1",[f.taskId]);}
  expect((await f.tick()).relaunched).toBe(1);expect((await f.read()).adds).toBe(1);expect(await f.payload()).toMatchObject({escort_id:NEW,commander_adopt_count:2});
 }));
 it('undefined policy without adapter preserves actual legacy adoption',()=>fixture(async f=>{expect((await f.tick({roleHandover:undefined})).adopted).toBe(1);expect((await f.read()).adds).toBe(0);expect(await f.payload()).toMatchObject({escort_id:OLD,commander_adopt_count:1});expect(f.phases).toEqual([]);}));
 for(const options of [{young:true},{fresh:true}])it('actual SQL refuses nonstale '+JSON.stringify(options),()=>fixture(async f=>{expect((await f.tick({existingRolePolicy:'replace-stale-existing'})).scanned).toBe(0);expect(f.phases).toEqual([]);expect((await f.read()).calls).toEqual([]);},options));
 it('fresh heartbeat recovery clears adopt count and real SQL suppresses policy IO',()=>fixture(async f=>{await recordCommanderHeartbeat(f.pool,{tag:ctx.tag,escort_id:OLD});expect((await f.tick({existingRolePolicy:'replace-stale-existing'})).scanned).toBe(0);expect((await f.read()).calls).toEqual([]);expect((await f.payload()).commander_adopt_count).toBe(0);}));
 it('unknown transport remains durable pending across repeated scanner ticks',()=>fixture(async f=>{expect((await f.tick({existingRolePolicy:'replace-stale-existing'})).failed).toBe(1);expect((await f.read()).adds).toBe(1);expect((await f.tick({existingRolePolicy:'replace-stale-existing'})).failed).toBe(1);expect((await f.read()).adds).toBe(1);expect((await f.pool.query('SELECT state FROM operations')).rows[0].state).toBe('pending');expect((await f.read()).calls).not.toContain('run');},{unknown:true}));
 it('durable committed candidate resumes payload failure without second add',()=>fixture(async f=>{expect((await f.tick({existingRolePolicy:'replace-stale-existing'})).failed).toBe(1);expect((await f.read()).adds).toBe(1);await f.disablePatch();expect((await f.tick({existingRolePolicy:'replace-stale-existing'})).relaunched).toBe(1);expect((await f.read()).adds).toBe(1);expect(await f.payload()).toMatchObject({escort_id:NEW});},{failPatch:true}));
 it('wrong actual role evidence rejects before rm/add/payload/run',()=>fixture(async f=>{expect((await f.tick({existingRolePolicy:'replace-stale-existing'})).failed).toBe(1);expect((await f.read()).adds).toBe(0);expect((await f.read()).calls).not.toContain('rm');expect(await f.payload()).toMatchObject({escort_id:OLD,commander_adopt_count:0});},{wrong:true}));
});


describe('PG fixture database CREATE boundary',()=>{
 for(const [database,gha,allowed] of [['cecelia_scratch',undefined,true],['cecelia_scratch','true',true],['cecelia_test',undefined,false],['cecelia_test','false',false],['cecelia_test',true,false],['cecelia_test','true',true],['cecelia','true',false],['cecelia_staging',undefined,false]])it('database '+database+' GITHUB_ACTIONS='+String(gha),async()=>{
  const calls=[],admin={query:async sql=>{calls.push(sql);return {rows:[{db:database}]};}};const operation=createFixtureSchema(admin,'unit_guard_fixture',gha);if(allowed){await operation;expect(calls).toEqual(['SELECT current_database() db','CREATE SCHEMA unit_guard_fixture']);}else{await expect(operation).rejects.toThrow('fixture_database_not_permitted');expect(calls).toEqual(['SELECT current_database() db']);}
 });
});
