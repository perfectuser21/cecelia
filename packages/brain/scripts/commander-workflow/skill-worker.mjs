#!/usr/bin/env node
// 单Activity工具执行Agent；线程归本次run的会话组，最终JSON只是待独立验收的提案。
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {durableWrite} from '../../src/orchestrator/activity-supervisor.js';
import {projectModelInput} from '../../src/orchestrator/commander-decision.js';
import {prepareCodexAuth,codexAuthEnvironment} from '../coding-workflow/lib/codex-auth.mjs';
import {codexWorkerArgs} from './skill-protocol.mjs';
import {createRunLedger,normalizeTurns} from '../../src/orchestrator/commander-usage-ledger.js';
import {sessionGroup,readSessionThread} from './session-group.mjs';
const chunks=[];for await(const c of process.stdin)chunks.push(c);
const request=JSON.parse(Buffer.concat(chunks).toString()),{codex,identity,thread_file,work_dir,skill_text,tools_text,context}=request;
if(createHash('sha256').update(fs.readFileSync(codex.command)).digest('hex')!==codex.command_sha256)throw Error('skill_codex_source_drift');
const auth=prepareCodexAuth(request.codex_auth,{codex});
const group=sessionGroup(request.session_group);
const previous=readSessionThread(thread_file,{run_id:identity.run_id,auth_identity:auth?.identity,session_group:group});
const output=path.join(work_dir,'proposal.json'),transcript=fs.openSync(path.join(work_dir,'agent.jsonl'),'a',0o600);
const activityInput=path.join(work_dir,'activity-input.json');
const promptContext=projectModelInput(context,{sourceFile:activityInput,sourceField:'context.verification.runtime_sha256'});
const prompt=['你只执行本次指定的单Activity，不推进其他Activity。运输方式 codex-cli，拥有工具；最终输出JSON提案不代表验收。',
  '禁止修改冻结Skill/合同/工具实现/独立检查器，禁止自行重跑已提交动作。',
  `本次动作身份：${JSON.stringify(identity)}`,`当前Activity：${request.activity_key}`,
  ...(request.activity_contract===undefined?[]:[`冻结Activity Contract：\n${JSON.stringify(request.activity_contract)}`,
    'Activity Contract优先于Skill。Skill只提供方法，不能修改目标、边界和验收标准；最终结果由独立检查器核验。']),
  `冻结Skill：\n${skill_text}`,
  `冻结工具说明：\n${tools_text}`,`输入与已独立验证的context：\n${JSON.stringify(promptContext)}`,
  '执行完只输出JSON对象提案；证据不足如实记录，不伪造独立检查结果。'].join('\n\n');
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG};
for(const key of codex.env_keys??[])if(process.env[key]!==undefined)env[key]=process.env[key];
durableWrite(activityInput,{identity,activity_key:request.activity_key,
  ...(request.activity_contract===undefined?{}:{activity_contract:request.activity_contract}),transport:'codex-cli',context});
env.COMMANDER_ACTIVITY_KEY=request.activity_key;env.COMMANDER_ACTIVITY_INPUT_FILE=activityInput;
let partial='',thread=previous?.thread_id;
const argv=codexWorkerArgs(codex,thread,output,auth),childEnv=codexAuthEnvironment(env,auth?.auth);
const ledger=request.ledger_directory?createRunLedger({directory:request.ledger_directory,identity:{task_id:identity.task_id,run_id:identity.run_id},policy:request.ledger_policy??{}}):null;
// model只来自实际固定CLI参数；缺字段不能根据默认值猜测计价。
let model='unknown';for(let i=0;i<(codex.args??[]).length;i++){
 const arg=codex.args[i];let config;
 if(['-c','--config'].includes(arg))config=codex.args[++i];else if(arg.startsWith('--config='))config=arg.slice(9);else if(arg.startsWith('-c')&&arg.length>2)config=arg.slice(2);
 if(typeof config==='string'&&/^model\s*=/.test(config)){const raw=config.slice(config.indexOf('=')+1).trim();try{const value=JSON.parse(raw);model=typeof value==='string'&&value?value:'unknown';}catch{model=raw.replace(/^'(.*)'$/,'$1')||'unknown';}}
 else if(['-m','--model'].includes(arg))model=codex.args[++i]||'unknown';else if(arg.startsWith('--model='))model=arg.slice(8)||'unknown';
}
let call;
try{call=ledger?.beginCall({role:'activity',activity_key:request.activity_key,action_id:identity.action_id,attempt:context.attempt??1,provider:'codex',model,auth_mode:request.codex_auth?.mode??'unknown'});}
catch(error){process.stdout.write(JSON.stringify({protocol:'skill-worker-failure/v1',reason_code:error.code??error.message,execution_stopped:true,dispatch_status:'not_started'}));fs.closeSync(transcript);throw error;}
const nativePath=call?path.join(call.directory,'native.jsonl'):null,nativeFd=call?fs.openSync(nativePath,'wx',0o600):null;
const events=[];let spawned=false,closed=false,failed,endedAt,spawnFailure,protocolFailure;
const child=spawn(codex.command,argv,{cwd:request.cwd,env:childEnv,stdio:['pipe','pipe','pipe']});
child.once('spawn',()=>{spawned=true;});child.once('error',error=>{spawnFailure=error;});
function recordEvent(line){
 let event;try{event=JSON.parse(line);}catch{return; /* 非JSON日志仅留原生transcript */}
 events.push(event);
 if(event?.type!=='thread.started'||protocolFailure)return;
 try{
  if(typeof event.thread_id!=='string'||!event.thread_id.trim())throw Error('skill_thread_invalid');
  if(thread&&thread!==event.thread_id)throw Error('skill_thread_changed');
  durableWrite(thread_file,{run_id:identity.run_id,thread_id:event.thread_id,...(auth?{auth_identity:auth.identity}:{}),...(group===undefined?{}:{session_group:group})});
  thread=event.thread_id;
 }catch(error){protocolFailure=error;child.kill('SIGTERM');}
}
child.stdout.on('data',data=>{fs.writeSync(transcript,data);if(nativeFd!==null)fs.writeSync(nativeFd,data);partial+=data.toString();let end;
  while((end=partial.indexOf('\n'))>=0){const line=partial.slice(0,end);partial=partial.slice(end+1);recordEvent(line);}
});
child.stderr.on('data',data=>fs.writeSync(transcript,data));
const timer=setInterval(()=>process.stderr.write(JSON.stringify({protocol:'activity-agent-event/v1',type:'heartbeat',activity:request.activity_key})+'\n'),1000);
try {
  child.stdin.on('error',()=>{});
  child.stdin.end(prompt);
  const code=await new Promise(resolve=>{child.once('close',code=>{closed=true;endedAt=Date.now();resolve(code);});});
  if(partial.trim()){recordEvent(partial);partial='';}
  if(protocolFailure)throw protocolFailure;
  if(code!==0||!thread)throw Error('skill_codex_execution_failed');
  const proposal=JSON.parse(fs.readFileSync(output,'utf8'));
  process.stdout.write(JSON.stringify({proposal,thread_id:thread}));
}catch(error){failed=error;throw error;}
finally{
 clearInterval(timer);fs.closeSync(transcript);
 if(nativeFd!==null){fs.fsyncSync(nativeFd);fs.closeSync(nativeFd);}
 const reason=spawnFailure?.code??failed?.code??failed?.message;
 if(call)ledger.finishCall(call.call_id,{status:!spawned&&spawnFailure?'not_started':closed?(failed?'failed':'completed'):'unknown',dispatch_status:spawned?'dispatched':spawnFailure?'not_started':'unknown',usage:normalizeTurns(events),...(failed?{reason_code:/^[a-zA-Z0-9][a-zA-Z0-9_.:/@+-]{0,255}$/.test(reason)?reason:'skill_proposal_invalid'}:{}),evidence_ref:nativePath,...(endedAt?{ended_at_ms:endedAt}:{})});
}
