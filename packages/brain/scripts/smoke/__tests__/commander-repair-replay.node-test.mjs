import test from 'node:test';
import {cleanupReplayFixture} from './fixtures/owned-replay-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
const brain=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const smoke=path.join(brain,'scripts/smoke/commander-repair-smoke.mjs');
const pgModule=pathToFileURL(createRequire(import.meta.url).resolve('pg')).href;
const database=process.env.TEST_DB_URL;
for(const [mutation,error] of [['calls','commander_replay_calls_changed'],['new-action','commander_replay_actions_changed'],['action-result','commander_replay_actions_changed'],['artifact','commander_replay_artifact_changed']]){
 test(`实际PG/host入口拒绝replay后的真实${mutation}副作用`,{skip:!database?'需要runtime-integration的隔离TEST_DB_URL':false,timeout:180000},async t=>{
  const url=new URL(database);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/cecelia_scratch');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repair-replay-regression-'));let closed=false,verified=false;
  t.after(()=>{const cleanup=cleanupReplayFixture({directory,closed,verified,aborted:t.signal.aborted});if(!cleanup.removed){t.diagnostic(`保留未确认清理的fixture: ${directory}`);assert.fail('owned_smoke_fixture_retained:'+cleanup.reason);}});
  const journal=path.join(directory,'injections.jsonl'),loader=path.join(directory,'inject.mjs');
  // Instrument only the smoke parent's replay launch; its host, PG journal, DBOS,
  // checker and real OS children remain the actual current production entrypoints.
  fs.writeFileSync(loader,`import fs from 'node:fs';import path from 'node:path';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
if(process.argv[1]===${JSON.stringify(smoke)}){
 const original=cp.spawn,done=new Set();
 cp.spawn=function(command,args,options){
  const at=args?.indexOf('--manifest');
  if(at>=0){
   const manifest=JSON.parse(fs.readFileSync(args[at+1]));const root=manifest.profile.cwd;
   if(root.startsWith(${JSON.stringify(directory+path.sep)})&&fs.existsSync(path.join(root,'replay.log'))&&!done.has(root)){
    done.add(root);
    const code=${JSON.stringify(`import fs from 'node:fs';import path from 'node:path';import pg from ${JSON.stringify(pgModule)};import {createHash} from 'node:crypto';
const root=process.env.INJECT_ROOT,run=process.env.INJECT_RUN,schema=process.env.COMMANDER_DATABASE_SCHEMA,kind=process.env.INJECT_KIND;
if(!/^repair_actions_[a-f0-9]{32}$/.test(schema))throw Error('wrong_owned_schema');
const url=new URL(process.env.TEST_DB_URL);if(url.hostname!=='127.0.0.1'||url.pathname!=='/cecelia_scratch')throw Error('wrong_owned_database');
const db=new pg.Client({connectionString:url.href});await db.connect();try{
 if((await db.query('SELECT current_database() AS db')).rows[0].db!=='cecelia_scratch')throw Error('wrong_database');
 const table=schema+'.commander_activity_actions';const before=(await db.query('SELECT action_id,activity_key,attempt,state,result FROM '+table+' WHERE run_id=$1 ORDER BY action_id',[run])).rows;
 const calls=()=>fs.readFileSync(path.join(root,'calls.jsonl'),'utf8').trim().split('\\n').length;const callsBefore=calls();
 if(kind==='calls')fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify({args:['owned-extra-model-call'],prompt:'unexpected replay call'})+'\\n');
 if(kind==='new-action')await db.query('INSERT INTO '+table+'(action_id,run_id,activity_key,identity,state,result,deadline_ms,attempt) SELECT $2,run_id,activity_key||$3,identity,state,result,deadline_ms,attempt FROM '+table+' WHERE run_id=$1 ORDER BY action_id LIMIT 1',[run,createHash('sha256').update('unexpected:'+run).digest('hex'),'-unexpected']);
 if(kind==='action-result')await db.query('UPDATE '+table+' SET result=result||$2::jsonb WHERE run_id=$1',[run,JSON.stringify({unexpected_replay_effect:true})]);
 if(kind==='artifact')fs.writeFileSync(path.join(root,'answer.json'),JSON.stringify({answer:43}));
 const after=(await db.query('SELECT action_id,activity_key,attempt,state,result FROM '+table+' WHERE run_id=$1 ORDER BY action_id',[run])).rows;
 fs.appendFileSync(process.env.INJECT_JOURNAL,JSON.stringify({mutation:kind,run_id:run,calls_before:callsBefore,calls_after:calls(),actions_before:before,actions_after:after,artifact:JSON.parse(fs.readFileSync(path.join(root,'answer.json'))),owned_child_pid:process.pid,applied:true})+'\\n');
}finally{await db.end();}`)};
    const result=cp.spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...options.env,INJECT_ROOT:root,INJECT_RUN:manifest.run.run_id,INJECT_KIND:${JSON.stringify(mutation)},INJECT_JOURNAL:${JSON.stringify(journal)}},encoding:'utf8',timeout:15000});
    if(result.status!==0)throw Error('owned_injection_failed:'+result.stderr);
   }
  }
  return original.call(this,command,args,options);
 };syncBuiltinESMExports();
}
`);
  const child=spawn(process.execPath,[smoke],{env:{...process.env,COMMANDER_REPAIR_REAL_CODEX:'0',COMMANDER_SMOKE_ARTIFACT_ROOT:directory,NODE_OPTIONS:`--import ${pathToFileURL(loader).href}`},stdio:['ignore','pipe','pipe']});
  child.once('close',()=>{closed=true;});
  let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  assert.equal(status.signal,null,stderr);assert.ok(fs.existsSync(journal),'必须先实际执行owned child/PG副作用，不能由导入失败假红: '+stderr);
  const injections=fs.readFileSync(journal,'utf8').trim().split('\n').map(JSON.parse);assert.ok(injections.length>0);assert.ok(injections.every(x=>x.applied));
  if(mutation==='calls')assert.ok(injections.every(x=>x.calls_after===x.calls_before+1));
  if(mutation==='new-action')assert.ok(injections.every(x=>x.actions_after.length===x.actions_before.length+1));
  if(mutation==='action-result')assert.ok(injections.every(x=>JSON.stringify(x.actions_after)!==JSON.stringify(x.actions_before)));
  if(mutation==='artifact')assert.ok(injections.every(x=>x.artifact.answer===43));
  t.diagnostic(JSON.stringify(injections.map(x=>({mutation:x.mutation,run_id:x.run_id,owned_child_pid:x.owned_child_pid,calls_before:x.calls_before,calls_after:x.calls_after,actions_before:x.actions_before.length,actions_after:x.actions_after.length,result_changed:JSON.stringify(x.actions_before)!==JSON.stringify(x.actions_after),artifact:x.artifact}))));
  assert.notEqual(status.code,0,`实际smoke不能将新增副作用报告为PASS: ${stdout}`);assert.match(stderr,new RegExp(error));verified=true;
 });
}
