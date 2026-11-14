#!/usr/bin/env node
// 单Activity工具执行Agent；线程归本workflow，最终JSON只是待独立验收的提案。
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {durableWrite} from '../../src/orchestrator/activity-supervisor.js';
import {projectModelInput} from '../../src/orchestrator/commander-decision.js';
import {prepareCodexAuth,codexAuthEnvironment} from '../coding-workflow/lib/codex-auth.mjs';
import {codexWorkerArgs} from './skill-protocol.mjs';
const chunks=[];for await(const c of process.stdin)chunks.push(c);
const request=JSON.parse(Buffer.concat(chunks).toString()),{codex,identity,thread_file,work_dir,skill_text,tools_text,context}=request;
if(createHash('sha256').update(fs.readFileSync(codex.command)).digest('hex')!==codex.command_sha256)throw Error('skill_codex_source_drift');
const auth=prepareCodexAuth(request.codex_auth,{codex});
const previous=fs.existsSync(thread_file)?JSON.parse(fs.readFileSync(thread_file,'utf8')):null;
if(previous&&(previous.run_id!==identity.run_id||(auth||previous.auth_identity)&&previous.auth_identity!==auth?.identity))throw Error('skill_thread_identity_conflict');
const output=path.join(work_dir,'proposal.json'),transcript=fs.openSync(path.join(work_dir,'agent.jsonl'),'a',0o600);
const activityInput=path.join(work_dir,'activity-input.json');
const promptContext=projectModelInput(context,{sourceFile:activityInput,sourceField:'context.verification.runtime_sha256'});
const prompt=['你只执行本次指定的单Activity，不推进其他Activity。运输方式 codex-cli，拥有工具；最终输出JSON提案不代表验收。',
  '禁止修改冻结Skill/合同/工具实现/独立检查器，禁止自行重跑已提交动作。',
  `本次动作身份：${JSON.stringify(identity)}`,`当前Activity：${request.activity_key}`,`冻结Skill：\n${skill_text}`,
  `冻结工具说明：\n${tools_text}`,`输入与已独立验证的context：\n${JSON.stringify(promptContext)}`,
  '执行完只输出JSON对象提案；证据不足如实记录，不伪造独立检查结果。'].join('\n\n');
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG};
for(const key of codex.env_keys??[])if(process.env[key]!==undefined)env[key]=process.env[key];
durableWrite(activityInput,{identity,activity_key:request.activity_key,transport:'codex-cli',context});
env.COMMANDER_ACTIVITY_KEY=request.activity_key;env.COMMANDER_ACTIVITY_INPUT_FILE=activityInput;
let partial='',thread=previous?.thread_id;
const child=spawn(codex.command,codexWorkerArgs(codex,thread,output,auth),{cwd:request.cwd,env:codexAuthEnvironment(env,auth?.auth),stdio:['pipe','pipe','pipe']});
child.stdout.on('data',data=>{fs.writeSync(transcript,data);partial+=data.toString();let end;
  while((end=partial.indexOf('\n'))>=0){const line=partial.slice(0,end);partial=partial.slice(end+1);try{const event=JSON.parse(line);
    if(event.type==='thread.started'&&typeof event.thread_id==='string'){
      if(thread&&thread!==event.thread_id){child.kill('SIGTERM');throw Error('skill_thread_changed');}
      thread=event.thread_id;durableWrite(thread_file,{run_id:identity.run_id,thread_id:thread,...(auth?{auth_identity:auth.identity}:{})});
    }}catch{ /* 非JSON日志仅留原生transcript */ }}
});
child.stderr.on('data',data=>fs.writeSync(transcript,data));
const timer=setInterval(()=>process.stderr.write(JSON.stringify({protocol:'activity-agent-event/v1',type:'heartbeat',activity:request.activity_key})+'\n'),1000);
try {
  child.stdin.end(prompt);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  if(code!==0||!thread)throw Error('skill_codex_execution_failed');
  const proposal=JSON.parse(fs.readFileSync(output,'utf8'));
  process.stdout.write(JSON.stringify({proposal,thread_id:thread}));
}finally{clearInterval(timer);fs.closeSync(transcript);}
