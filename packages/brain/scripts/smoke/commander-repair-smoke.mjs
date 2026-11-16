#!/usr/bin/env node
// 真PG、DBOS、监督进程和独立checker；可显式启用真实Codex订阅进行同会话返工验收。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import pg from 'pg';
const brain=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const url=new URL(process.env.TEST_DB_URL??'');
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/cecelia_scratch');
const real=process.env.COMMANDER_REPAIR_REAL_CODEX==='1';
const artifactRoot=fs.mkdtempSync(path.join(process.env.COMMANDER_SMOKE_ARTIFACT_ROOT??os.tmpdir(),'commander-repair-'));
const suffix=randomUUID().replaceAll('-',''),schema='repair_actions_'+suffix,dbosSchema='repair_history_'+suffix;
const pool=new pg.Pool({connectionString:url.href});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const until=async fn=>{const end=Date.now()+(real?420000:30000);while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('repair_smoke_timeout');};
function launch(root,name){
 const fd=fs.openSync(path.join(root,name+'.log'),'a',0o600);
 const child=spawn(process.execPath,[path.join(brain,'scripts/commander-workflow/host.mjs'),'--manifest',path.join(root,'manifest.json'),'--result',path.join(root,'result.json')],
  {stdio:['ignore',fd,fd],env:{...process.env,DBOS_DURABLE_ENABLED:'true',COMMANDER_DATABASE_URL:url.href,COMMANDER_DATABASE_SCHEMA:schema,COMMANDER_DBOS_SCHEMA:dbosSchema}});
 fs.closeSync(fd);return child;
}
async function scenario(name){
 const root=path.join(artifactRoot,name);fs.mkdirSync(root,{mode:0o700});
 const files={};const put=(name,text)=>{fs.writeFileSync(path.join(root,name),text);files[name]=hash(text);};
 put('adapter.mjs',`import fs from 'node:fs';import {createRuntime as createSkill} from ${JSON.stringify(pathToFileURL(path.join(brain,'scripts/commander-workflow/skill-adapter.mjs')).href)};
export async function createRuntime(options){const runtime=await createSkill(options);return {...runtime,decide:async request=>{fs.appendFileSync(options.profile.cwd+'/decisions.jsonl',JSON.stringify(request)+'\\n');const {protocol,run_id,definition_sha256,sequence,state_sha256}=request;return {protocol,run_id,definition_sha256,sequence,state_sha256,...request.allowed_actions[0],reason:'依据本次允许动作及失败证据'};}};}`);
 put('entry.mjs','// 具体执行通过冻结的Skill适配器。\n');
 put('skill.txt','本次是隔离返工故障注入验收。只允许写当前目录的 answer.json，JSON对象包含 answer 数字。首次无 checker_feedback 时故意写 {"answer":0} 并交付；收到 checker_feedback 后，读取 failed_checks 的 expected，将 answer 改成该值并交付。不得修改checker、skill、工具或其他文件。最后输出JSON对象提案。');
 put('tools.txt','使用文件读写工具在当前工作目录操作 answer.json，随后读回该文件。不要操作生产、外部账号、数据库、网络、其他目录。');
 put('check.cjs',`const fs=require('fs');let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const r=JSON.parse(s),start=r.phase==='start';let answer=null;try{answer=JSON.parse(fs.readFileSync('answer.json')).answer;}catch{}const ok=start||answer===42;const check={id:r.checks[0],status:ok?'passed':'failed',evidence:[{source:'answer.json',observation:{answer,phase:r.phase}}],...(!ok?{expected:42,actual:answer,reason:'answer必须为42'}:{})};console.log(JSON.stringify({identity:Object.fromEntries(['task_id','run_id','run_tag','workflow','activity','attempt'].map(k=>[k,r[k]])),nonce:r.nonce,outcome:ok?'passed':'failed',checks:[check],output:{answer},...(!ok?{retryable:true,external_effect:'none'}:{})}));});`);
 put('codex.cjs',`const fs=require('fs');let prompt='';process.stdin.on('data',d=>prompt+=d);process.stdin.on('end',async()=>{fs.appendFileSync('calls.jsonl',JSON.stringify({args:process.argv,prompt})+'\\n');const repair=process.argv.includes('resume');if(repair&&${JSON.stringify(name)}==='host-kill'){fs.writeFileSync('second-started','yes');while(!fs.existsSync('release-second'))await new Promise(r=>setTimeout(r,30));}const answer=repair&&${JSON.stringify(name)}!=='exhaust'?42:0;fs.writeFileSync('answer.json',JSON.stringify({answer}));fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({answer}));console.log(JSON.stringify({type:'thread.started',thread_id:'repair-thread'}));});`);
 const codexBin=real?fs.realpathSync(process.env.COMMANDER_CODEX_BIN??'/opt/homebrew/bin/codex'):process.execPath;
 const run={schema_version:1,task_id:randomUUID(),run_id:randomUUID(),deadline_ms:Date.now()+(real?600000:90000),commander_timeout_ms:real?120000:5000,input:{run_tag:randomUUID()},
  contract:{workflow:'checker-repair-proof',goal:'独立验收answer=42，失败回原Agent修复，禁止未验收交付',activities:[{key:'produce',order:1,budget:{max_duration_s:real?360:45,heartbeat_s:1},failure:{empty_ok:[],retryable:[],fatal:[],needs_human:{cases:['unknown']}},runtime:{phase:'source',protocol:'json-stdio-v1',entry:'entry.mjs',executor_kind:'agent',checker_repair:{max_attempts:3,retry_safe:true}}}]}};
 const profile={cwd:root,adapter:'adapter.mjs',files,
  commander:real?{provider:'codex',model:process.env.COMMANDER_CODEX_MODEL??'gpt-6-astra',codexHome:process.env.CODEX_HOME,codexBin,transcriptPath:path.join(root,'commander.jsonl')}:{provider:'adapter'},
  ...(real?{codex_auth:{mode:'subscription',home:process.env.CODEX_HOME}}:{}),
  skill_runtime:{control_dir:'control',tools:'tools.txt',codex:{command:codexBin,command_sha256:hash(fs.readFileSync(codexBin)),args:real?['-m',process.env.COMMANDER_CODEX_MODEL??'gpt-6-astra']:[path.join(root,'codex.cjs')]},
   activities:{produce:{skill:'skill.txt',session_group:'producer',checker:{command:process.execPath,command_sha256:hash(fs.readFileSync(process.execPath)),entry:'check.cjs',start_checks:['authority'],required_checks:['answer']}}}}};
 fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({run,profile}));
 let child=launch(root,'host');
 try{
  if(name==='host-kill'){
   await until(()=>fs.existsSync(path.join(root,'second-started'))||child.exitCode!==null);
   assert(fs.existsSync(path.join(root,'second-started')),'第二轮尚未真实启动');
   child.kill('SIGKILL');await until(()=>child.signalCode!==null);
   fs.writeFileSync(path.join(root,'release-second'),'yes');child=launch(root,'resumed-host');
  }
  await until(()=>child.exitCode!==null||child.signalCode!==null);
  assert.equal(child.exitCode,name==='exhaust'?2:0,'宿主失败，查看 '+root);
  const result=read(path.join(root,'result.json')),expected=name==='exhaust'?3:2;
  assert.equal(result.status,name==='exhaust'?'needs_review':'completed');
  assert.equal(result.attempt_history.length,expected);
  const first=result.attempt_history[0].activities[0].attempts[0].checker_feedback;
  assert.equal(first.failed_checks[0].expected,42);assert.equal(first.failed_checks[0].actual,0);
  const rows=(await pool.query(`SELECT attempt,state,identity,result,deadline_ms FROM ${schema}.commander_activity_actions WHERE run_id=$1 ORDER BY attempt`,[run.run_id])).rows;
  assert.equal(rows.length,expected);assert(rows.every(row=>row.state==='settled'));assert.equal(new Set(rows.map(r=>r.deadline_ms)).size,1);
  if(name==='exhaust'){assert.equal(result.escalation.decision.action,'pause');assert.equal(result.escalation.error,undefined);}
  else assert.equal(read(path.join(root,'answer.json')).answer,42);
  if(!real){const calls=fs.readFileSync(path.join(root,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(calls.length,expected);assert(calls[1].args.includes('resume'));assert(calls[1].args.includes(first.thread_id));assert(calls[1].prompt.includes('answer必须为42'));}
  else {
   const actions=path.join(root,'control',run.run_id,'actions');
   const secondInput=read(path.join(actions,rows[1].identity.action_id,'activity-input.json'));
   assert.equal(secondInput.context.checker_feedback.thread_id,first.thread_id);
   const threads=fs.readdirSync(path.join(root,'control',run.run_id,'sessions')).map(n=>read(path.join(root,'control',run.run_id,'sessions',n,'thread.json')));
   assert(threads.some(t=>t.thread_id===first.thread_id));
  }
  // 再启动同一manifest必须读回DBOS终态，既不增动作也不增模型调用。
  const before=JSON.stringify(result.run_report.ledger);child=launch(root,'replay');await until(()=>child.exitCode!==null);assert.equal(child.exitCode,name==='exhaust'?2:0);
  assert.equal(JSON.stringify(read(path.join(root,'result.json')).run_report.ledger),before);
  const proof={scenario:name,real_codex:real,status:result.status,attempts:rows.length,same_thread:true,original_deadline:true,replay_no_new_calls:true,run_id:run.run_id,artifact_root:root};
  fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(proof,null,2));return proof;
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
}
try{
 const actual=(await pool.query('SELECT current_database() AS db')).rows[0];assert.equal(actual.db,'cecelia_scratch');
 await pool.query(`CREATE SCHEMA ${schema}`);await pool.query(`SET search_path TO ${schema}`);
 for(const migration of ['558_commander_activity_actions.sql','559_commander_activity_attempts.sql'])await pool.query(fs.readFileSync(path.join(brain,'migrations',migration),'utf8'));
 const scenarios=[];for(const name of real?['normal']:['normal','exhaust','host-kill'])scenarios.push(await scenario(name));
 const proof={verdict:'pass',schema,dbos_schema:dbosSchema,artifact_root:artifactRoot,scenarios};
 fs.writeFileSync(path.join(artifactRoot,'verification.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}finally{await pool.end();}
