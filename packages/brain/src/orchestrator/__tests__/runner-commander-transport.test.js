import {test,expect} from 'vitest';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createCommanderTransport} from '../runner-commander-transport.js';
import {createOpenClawCommanderTransport} from '../runner-commander-transport.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const hash=s=>createHash('sha256').update(s).digest('hex');
test('固定Commander进程收到版本化Skill全文，来源漂移禁止运行',async()=>{
 const cwd=await fs.mkdtemp(join(tmpdir(),'commander-transport-'));
 try{
  const code=`let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);console.log(JSON.stringify({action:'steer',text:x.skill.content+' '+x.run_id}));`;
  await fs.writeFile(join(cwd,'commander.mjs'),code);await fs.writeFile(join(cwd,'commander.md'),'按验收纠偏');
  const transport=createCommanderTransport({cwd,profile:{entry:'commander.mjs',skill:{entry:'commander.md',version:'1.0.0'}},files:{'commander.mjs':hash(code),'commander.md':hash('按验收纠偏')}});
  expect(await transport({run_id:'run1',phase:'wake'})).toEqual({action:'steer',text:'按验收纠偏 run1'});
  await fs.writeFile(join(cwd,'commander.md'),'弱化规则');
  await expect(transport({run_id:'run1',phase:'event'})).rejects.toThrow(/source_mismatch/);
 }finally{await fs.rm(cwd,{recursive:true,force:true});}
});

test('真实Gateway fixture CLI验证终态runId，固定agent及同run会话，并注入固定Skill',async()=>{
 const cwd=await fs.mkdtemp(join(tmpdir(),'commander-openclaw-'));
 try{
  await fs.writeFile(join(cwd,'skill.md'),'禁止判断通过；只纠偏');
  const fixture=join(cwd,'gateway.mjs');
  await fs.writeFile(fixture,`const fs=await import('node:fs');const args=process.argv.slice(2),x=JSON.parse(args[args.indexOf('--params')+1]);fs.appendFileSync('trace',JSON.stringify(x)+'\\n');console.log(JSON.stringify({runId:x.idempotencyKey,status:'ok',payloads:[{text:JSON.stringify({action:'steer',text:'补齐验收证据'})}]}));`);
  const exec=promisify(execFile);
  const transport=createOpenClawCommanderTransport({cwd,profile:{kind:'openclaw',timeout_s:2,skill:{entry:'skill.md',version:'1.0.0'}},files:{'skill.md':hash('禁止判断通过；只纠偏')},execute:(_command,args,options)=>exec(process.execPath,[fixture,...args],{...options,cwd})});
  expect(await transport({run_id:'r1',phase:'wake'})).toEqual({action:'steer',text:'补齐验收证据'});
  await transport({run_id:'r1',phase:'event'});
  const calls=(await fs.readFile(join(cwd,'trace'),'utf8')).trim().split('\n').map(JSON.parse);
  expect(calls[0].agentId).toBe('work-commander');
  expect(calls[0].sessionKey).toBe(calls[1].sessionKey);
  expect(calls[0].idempotencyKey).not.toBe(calls[1].idempotencyKey);
  expect(calls[0].message).toContain('禁止判断通过；只纠偏');
  await fs.writeFile(fixture,`console.log(JSON.stringify({runId:'wrong',status:'accepted',payloads:[{text:'{"action":"none"}'}]}));`);
  await expect(transport({run_id:'r1',phase:'event'})).rejects.toThrow(/final_required|identity_invalid/);
 }finally{await fs.rm(cwd,{recursive:true,force:true});}
});

test('本地Commander真实进程死亡后桥可启动新观察回合',async()=>{
 const cwd=await fs.mkdtemp(join(tmpdir(),'commander-death-'));
 try{
  const code=`import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);if(!fs.existsSync('died')){fs.writeFileSync('died',String(process.pid));process.kill(process.pid,'SIGKILL');}console.log(JSON.stringify({action:'answer',text:x.run_id}));`;
  await fs.writeFile(join(cwd,'commander.mjs'),code);await fs.writeFile(join(cwd,'skill.md'),'只观察');
  const transport=createCommanderTransport({cwd,profile:{entry:'commander.mjs',timeout_s:2,skill:{entry:'skill.md',version:'1'}},files:{'commander.mjs':hash(code),'skill.md':hash('只观察')}});
  const {createCommanderBridge}=await import('../runner-commander-bridge.js');
  const c=createCommanderBridge({run_id:'original-run',transport});await c.wake();
  expect(await c.notify('generic-work',{}, {executor_kind:'agent'})).toEqual({action:'answer',text:'original-run'});
  expect(c.status).toBe('available');
 }finally{await fs.rm(cwd,{recursive:true,force:true});}
});
test('Gateway失败后只查原runId，未终态禁止新agent，终态后可再观察',async()=>{
 const cwd=await fs.mkdtemp(join(tmpdir(),'commander-wait-'));
 try{
  await fs.writeFile(join(cwd,'skill.md'),'只观察');let original,finished=false,starts=0;const waits=[];
  const execute=async(_cmd,args)=>{const x=JSON.parse(args[args.indexOf('--params')+1]);
   if(args[2]==='agent.wait'){waits.push(x.runId);return {stdout:JSON.stringify(finished?{status:'error',endedAt:123}:{status:'pending'})};}
   starts++;if(starts===1){original=x.idempotencyKey;throw Error('connection_closed');}
   return {stdout:JSON.stringify({runId:x.idempotencyKey,status:'ok',payloads:[{text:'{"action":"none"}'}]})};
  };
  const t=createOpenClawCommanderTransport({cwd,profile:{timeout_s:1,skill:{entry:'skill.md',version:'1'}},files:{'skill.md':hash('只观察')},execute});
  await expect(t({run_id:'r'})).rejects.toThrow();
  expect(await t.reconcile({run_id:'r'})).toEqual({execution_stopped:false});
  await expect(t({run_id:'r'})).rejects.toThrow(/previous_turn_unknown/);expect(starts).toBe(1);
  finished=true;expect(await t.reconcile({run_id:'r'})).toEqual({execution_stopped:true});
  expect(await t({run_id:'r'})).toEqual({action:'none'});expect(waits).toEqual([original,original]);
 }finally{await fs.rm(cwd,{recursive:true,force:true});}
});
