import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import os from 'node:os';
import {test,expect,afterAll,beforeAll} from 'vitest';
import {DBOSClient} from '@dbos-inc/dbos-sdk';
import {closeoutCommander} from '../../../scripts/commander-workflow/supervisor-closeout.mjs';
import {databaseConfig} from '../../../scripts/commander-workflow/runtime-support.mjs';
import {loadCommanderManifest} from '../../../scripts/commander-workflow/host.mjs';
import {normalizeCommanderRun} from '../commander-decision.js';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'commander-regression-'));
const brain=fileURLToPath(new URL('../../../',import.meta.url));
const task=randomUUID();
const url=process.env.TEST_DB_URL;const enabled=!!url;
if(enabled){const parsed=new URL(url);if(!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)||parsed.pathname!=='/cecelia_scratch')throw Error('regression_requires_loopback_scratch');}
const runs=[];
const pool=enabled?new pg.Pool({connectionString:url}):null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const read=p=>JSON.parse(fs.readFileSync(p));
async function until(f,ms=15000){let end=Date.now()+ms;while(Date.now()<end){if(f())return;await sleep(40);}throw Error('audit_wait_timeout');}
const adapter=`import fs from 'node:fs';
import path from 'node:path';
export async function createRuntime({profile,run}) {
 const p=n=>path.join(profile.cwd,n);fs.appendFileSync(p('runtime'),'x');
 const result=input=>({schema_version:1,run_tag:input.run_tag,status:'completed',outputs:{},metrics:{},evidence:[p('effects.jsonl')],execution_stopped:true});
 const log=(event,extra={})=>fs.appendFileSync(p('events.jsonl'),JSON.stringify({event,time:Date.now(),bound_input:run.input,...extra})+'\\n');
 return {
  decide:async r=>{log('decide',{sequence:r.sequence,request_input:r.input});return {protocol:r.protocol,run_id:r.run_id,definition_sha256:r.definition_sha256,sequence:r.sequence,state_sha256:r.state_sha256,...r.allowed_actions[0],reason:'隔离故障审计'};},
  executeActivity:async(a,input)=>{log('execute',{key:a.key,input});fs.appendFileSync(p('effects.jsonl'),JSON.stringify({key:a.key,bound_input:run.input,input})+'\\n');if(a.key==='first'&&!fs.existsSync(p('resume'))) {fs.writeFileSync(p('started'),'1');await new Promise(()=>{});}return result(input);},
  inspectActivity:async(a,input,options)=>{log('inspect',{key:a.key,input});return {state:'completed',identity:options.identity,execution_stopped:true,result:result(input)};},
  checkActivity:async()=>({verdict:'pass'})
 };
}`;
function fixture(name,deadline){
 const dir=path.join(root,name);fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,'adapter.mjs'),adapter);
 const activity=(key,order)=>({key,order,budget:{max_duration_s:60,heartbeat_s:1},failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:[]}},runtime:{phase:'source',protocol:'json-stdio-v1',entry:'adapter.mjs',executor_kind:'code'}});
 const manifest={profile:{cwd:dir,adapter:'adapter.mjs',files:{'adapter.mjs':createHash('sha256').update(adapter).digest('hex')},commander:{provider:'adapter'}},run:{schema_version:1,task_id:task,run_id:randomUUID(),deadline_ms:Date.now()+deadline,commander_timeout_ms:2000,input:{run_tag:randomUUID(),target:'original'},contract:{workflow:'isolated-runtime-audit',activities:[activity('first',1),activity('second',2)]}}};
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));runs.push(manifest.run.run_id);return {dir,manifest};
}
function launch(f,supervise=false,tag='host',connection=url){
 const fd=fs.openSync(path.join(f.dir,tag+'.log'),'a',0o600);
 const proc=spawn(process.execPath,[brain+'/scripts/commander-workflow/'+(supervise?'supervise':'host')+'.mjs','--manifest',path.join(f.dir,'manifest.json'),'--result',path.join(f.dir,'result.json')],{detached:true,stdio:['ignore',fd,fd],env:{...process.env,DBOS_DURABLE_ENABLED:'true',COMMANDER_DATABASE_URL:connection,COMMANDER_DATABASE_SCHEMA:'commander_workflow_actions',COMMANDER_DBOS_SCHEMA:'commander_workflow_dbos'}});fs.closeSync(fd);return proc;
}
function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
function kill(pid){if(pid){try{process.kill(pid,'SIGKILL');}catch{}}}
async function dbState(f){return (await pool.query('SELECT workflow_uuid,status,recovery_attempts FROM commander_workflow_dbos.workflow_status WHERE workflow_uuid=$1',['commander-foundation:'+f.manifest.run.run_id])).rows;}

beforeAll(async()=>{
 if(enabled&&process.env.CI==='true'){
  await pool.query('CREATE SCHEMA IF NOT EXISTS commander_workflow_actions');const db=await pool.connect();
  try{await db.query('SET search_path TO commander_workflow_actions');await db.query(fs.readFileSync(path.join(brain,'migrations/558_commander_activity_actions.sql'),'utf8'));}finally{db.release();}
 }
});
afterAll(async()=>{
 if(pool){
  const exists=(await pool.query("SELECT to_regclass('commander_workflow_dbos.workflow_status') AS name")).rows[0].name;
  if(exists){const client=await DBOSClient.create({systemDatabaseUrl:url,systemDatabaseSchemaName:'commander_workflow_dbos'});try{for(const id of runs){const workflow=await client.getWorkflow('commander-foundation:'+id);if(workflow?.status==='PENDING')await client.cancelWorkflow(workflow.workflowID);}}finally{await client.destroy();}}
  await pool.end();
 }
 fs.rmSync(root,{recursive:true,force:true});
});
test.each(['host.mjs','supervise.mjs','report.mjs'])('软链入口%s不得静默成功',name=>{
 const link=path.join(root,'linked-'+name);fs.symlinkSync(path.join(brain,'scripts/commander-workflow',name),link);
 const r=spawnSync(process.execPath,[link,'--invalid-regression-argument'],{encoding:'utf8',timeout:10000});expect(r.status).not.toBe(0);expect(r.stderr).toContain('usage:');
});
test.skipIf(!enabled).each(['input','task_id','contract'])('恢复前拒绝改变%s且不载入adapter',async field=>{
 const f=fixture('identity-'+field,30000);let first,second;
 try{first=launch(f,false,'first');await until(()=>fs.existsSync(path.join(f.dir,'started')));kill(first.pid);await until(()=>first.signalCode!==null||first.exitCode!==null);
 if(field==='input')f.manifest.run.input.target='changed';if(field==='task_id')f.manifest.run.task_id=randomUUID();if(field==='contract')f.manifest.run.contract.goal='changed';
 fs.writeFileSync(path.join(f.dir,'manifest.json'),JSON.stringify(f.manifest));fs.writeFileSync(path.join(f.dir,'resume'),'1');second=launch(f,false,'second');await until(()=>second.signalCode!==null||second.exitCode!==null);
 expect(second.exitCode).toBe(1);expect(fs.readFileSync(path.join(f.dir,'second.log'),'utf8')).toContain('commander_identity_conflict');expect(fs.readFileSync(path.join(f.dir,'runtime'),'utf8')).toBe('x');expect(fs.readFileSync(path.join(f.dir,'effects.jsonl'),'utf8').trim().split('\n')).toHaveLength(1);expect((await dbState(f))[0].status).toBe('PENDING');
 }finally{kill(first?.pid);kill(second?.pid);}
},25000);
test.skipIf(!enabled)('SIGSTOP宿主可安全接管且旧动作不重发',async()=>{
 const f=fixture('heartbeat',30000);let proc,pid;
 try{proc=launch(f,true);await until(()=>fs.existsSync(path.join(f.dir,'started')));pid=read(path.join(f.dir,'result.json.supervisor.json')).child.pid;process.kill(pid,'SIGSTOP');fs.writeFileSync(path.join(f.dir,'resume'),'1');await until(()=>proc.signalCode!==null||proc.exitCode!==null,18000);
 expect(proc.exitCode).toBe(0);expect(read(path.join(f.dir,'result.json')).status).toBe('completed');expect(read(path.join(f.dir,'result.json.supervisor.json')).starts).toBe(2);expect(alive(pid)).toBe(false);expect(fs.readFileSync(path.join(f.dir,'effects.jsonl'),'utf8').trim().split('\n')).toHaveLength(2);
 }catch(error){error.message+='\n'+fs.readFileSync(path.join(f.dir,'result.json.supervisor.json.log'),'utf8');throw error;}finally{kill(pid);const p=path.join(f.dir,'result.json.supervisor.json');if(fs.existsSync(p))kill(read(p).child?.pid);kill(proc?.pid);}
},23000);
test.skipIf(!enabled)('期限到达停止卡死宿主并关闭DBOS pending',async()=>{
 const f=fixture('deadline',3000);let proc,pid;
 try{proc=launch(f,true);await until(()=>fs.existsSync(path.join(f.dir,'started')));pid=read(path.join(f.dir,'result.json.supervisor.json')).child.pid;process.kill(pid,'SIGSTOP');await until(()=>proc.signalCode!==null||proc.exitCode!==null,12000);
 expect(alive(pid)).toBe(false);expect(fs.existsSync(path.join(f.dir,'result.json'))).toBe(true);const result=read(path.join(f.dir,'result.json'));expect(result.status).toBe('needs_review');expect(result.execution_unknown).toBe(true);expect((await dbState(f))[0].status).toBe('CANCELLED');
 }finally{kill(pid);kill(proc?.pid);}
},18000);
test.skipIf(!enabled)('连接URL options不覆盖指定动作schema',async()=>{
 const f=fixture('options',30000);fs.writeFileSync(path.join(f.dir,'resume'),'1');const u=new URL(url);u.searchParams.set('options','-c statement_timeout=5000 -c search_path=public');let proc;
 try{proc=launch(f,false,'host',u.href);await until(()=>proc.signalCode!==null||proc.exitCode!==null);expect(proc.exitCode).toBe(0);expect(read(path.join(f.dir,'result.json')).status).toBe('completed');}finally{kill(proc?.pid);}
},22000);

test.skipIf(!enabled)('收尾必须持原宿主锁，不能取消另一宿主的运行',async()=>{
 const f=fixture('closeout-owner',30000);let proc;const owner=new pg.Client({connectionString:url});
 try{proc=launch(f);await until(()=>fs.existsSync(path.join(f.dir,'started')));const run=normalizeCommanderRun(loadCommanderManifest(path.join(f.dir,'manifest.json')).run);
 await expect(closeoutCommander(run,'deadline',{url})).rejects.toThrow('commander_closeout_owner_busy');expect((await dbState(f))[0].status).toBe('PENDING');
 }finally{kill(proc?.pid);await owner.end();}
},20000);
test.skipIf(!enabled)('结果文件未发布但DBOS已成功，收尾保留成功事实',async()=>{
 const f=fixture('closeout-success',30000);fs.writeFileSync(path.join(f.dir,'resume'),'1');let proc;
 try{proc=launch(f);await until(()=>proc.signalCode!==null||proc.exitCode!==null);const original=read(path.join(f.dir,'result.json'));fs.unlinkSync(path.join(f.dir,'result.json'));
 const run=normalizeCommanderRun(loadCommanderManifest(path.join(f.dir,'manifest.json')).run);const result=await closeoutCommander(run,'deadline',{url});expect(result.status).toBe('completed');expect(result.outputs).toEqual(original.outputs);expect((await dbState(f))[0].status).toBe('SUCCESS');
 }finally{kill(proc?.pid);}
},20000);

test.skipIf(!enabled)('真实连接保留URL指定的statement_timeout',async()=>{
 const u=new URL(url);u.searchParams.set('options','-c statement_timeout=1234 -c search_path=public');const client=new pg.Client(databaseConfig(u.href,{schema:'commander_workflow_actions'}));
 try{await client.connect();const row=(await client.query("SELECT current_setting('statement_timeout') AS timeout,current_schema() AS schema")).rows[0];expect(row.timeout).toBe('1234ms');expect(row.schema).toBe('commander_workflow_actions');}finally{await client.end();}
});
