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
