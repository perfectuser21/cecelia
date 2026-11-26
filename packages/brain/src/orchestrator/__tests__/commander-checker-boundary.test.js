import {test,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {frozenNodeCommand} from './fixtures/frozen-node-command.js';
import {createRuntime} from '../../../scripts/commander-workflow/skill-adapter.mjs';
async function fixture(script,timeout_ms=2000,activity={key:'collect'},frozenActivities){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'commander-checker-boundary-'));fs.chmodSync(root,0o700);
 const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 fs.writeFileSync(path.join(root,'check.cjs'),script);fs.writeFileSync(path.join(root,'skill.txt'),'活动');fs.writeFileSync(path.join(root,'tools.txt'),'工具');
 const nodeCommand=frozenNodeCommand(root);
 const checker={...nodeCommand,entry:'check.cjs',start_checks:['identity'],required_checks:['identity'],timeout_ms};
 const profile={cwd:root,files:Object.fromEntries(['skill.txt','tools.txt','check.cjs'].map(f=>[f,sha(path.join(root,f))])),skill_runtime:{control_dir:'control',tools:'tools.txt',codex:nodeCommand,activities:{collect:{skill:'skill.txt',checker}}}};
 const runtime=await createRuntime({profile,run:{task_id:'task',run_id:'run',input:{run_tag:'tag'},contract:{workflow:'101',...(frozenActivities===undefined?{}:{activities:frozenActivities})},playbook:{schema_version:1,content:'仅供Commander的Workflow方法'}}});
 return {root,check:()=>runtime.checkActivity(activity,null,{phase:'start',input:{run_tag:'tag'}}),records:()=>{
  const directory=path.join(root,'control','run','checks');return fs.readdirSync(directory).map(f=>JSON.parse(fs.readFileSync(path.join(directory,f),'utf8')));
 },close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const passed=`let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const fs=require('fs'),r=JSON.parse(s);fs.writeFileSync('checker-started','yes');MUTATION;console.log(JSON.stringify({identity:Object.fromEntries(['task_id','run_id','run_tag','workflow','activity','attempt'].map(k=>[k,r[k]])),nonce:r.nonce,outcome:'passed',checks:r.checks.map(id=>({id,status:'passed',evidence:[{source:'native',observation:{verified:true}}]})),output:{verified:42}}));});`;
test.each(['before','during'])('checker源码%s普通漂移不能通过，已观察结果保留',async when=>{
 const f=await fixture(passed.replace('MUTATION',when==='during'?`fs.appendFileSync(__filename,'// changed')`:'void 0'));
 try{
  if(when==='before')fs.appendFileSync(path.join(f.root,'check.cjs'),'// changed');
  await expect(f.check()).rejects.toThrow('commander_source_drift');
  expect(fs.existsSync(path.join(f.root,'checker-started'))).toBe(when==='during');
  const [saved]=f.records();expect(saved.reason).toBe('commander_source_drift');expect(saved.request.nonce).toBeTruthy();
  if(when==='during'){expect(saved.status).toBe('rejected');expect(saved.observed.output).toEqual({verified:42});expect(saved.observed.nonce).toBe(saved.request.nonce);}
 }finally{f.close();}
});
test.each(['invalid_json','nonzero_exit','timeout'])('checker运输失败%s仍保留有界原始证据且不通过',async mode=>{
 const script=mode==='invalid_json'?`process.stdout.write('not-json');process.stderr.write('parse-diagnostic');`
  :mode==='nonzero_exit'?`process.stdout.write('partial-output');process.stderr.write('exit-diagnostic');process.exitCode=7;`
   :`process.stdout.write('partial-output');process.stderr.write('timeout-diagnostic');setInterval(()=>{},1000);`;
 const f=await fixture(script,mode==='timeout'?500:2000);
 try{
  await expect(f.check()).rejects.toThrow();const records=f.records();expect(records).toHaveLength(1);const [saved]=records;
  expect(saved.request.nonce).toBeTruthy();expect(saved.request.checks).toEqual(['identity']);expect(saved.verified).toBeUndefined();expect(saved.env).toBeUndefined();
  expect(saved.transport.stdout).toBe(mode==='invalid_json'?'not-json':'partial-output');expect(saved.transport.stderr).toContain('diagnostic');
  expect(saved.transport.stdout.length).toBeLessThanOrEqual(4*1024*1024);expect(saved.transport.stderr.length).toBeLessThanOrEqual(10000);
  if(mode==='invalid_json'){expect(saved.status).toBe('parse_error');expect(saved.reason).toBe('skill_checker_invalid_json');expect(saved.transport.exit_code).toBe(0);}
  if(mode==='nonzero_exit'){expect(saved.reason).toBe('skill_checker_failed');expect(saved.transport.exit_code).toBe(7);}
  if(mode==='timeout'){expect(saved.reason).toBe('skill_checker_timeout');expect(saved.transport.timed_out).toBe(true);expect(saved.transport.signal).toBe('SIGKILL');}
 }finally{f.close();}
});

test('独立checker实际收到本步Contract，不接收Skill或Workflow Playbook方法',async()=>{
 const activity={key:'collect',acceptance:['原生身份与目标产物均读回'],failure:{needs_human:{cases:['身份不能证实']}}};
 const f=await fixture(passed.replace('MUTATION',`fs.writeFileSync('checker-request.json',JSON.stringify(r))`),2000,activity);
 try{
  expect((await f.check()).verdict).toBe('pass');
  const received=JSON.parse(fs.readFileSync(path.join(f.root,'checker-request.json'),'utf8'));
  const [saved]=f.records();
  expect(received.activity_contract).toEqual(activity);
  expect(saved.request.activity_contract).toEqual(activity);
  expect(received).not.toHaveProperty('skill_text');expect(received).not.toHaveProperty('playbook');
  expect(JSON.stringify(received)).not.toContain('仅供Commander的Workflow方法');
  expect(received.checks).toEqual(['identity']);
 }finally{f.close();}
});

test('run已有冻结活动清单时不能用未绑定Activity契约启动checker',async()=>{
 const f=await fixture(passed.replace('MUTATION','void 0'),2000,{key:'collect'},[{key:'other'}]);
 try{
  await expect(f.check()).rejects.toThrow('skill_activity_contract_unbound');
  expect(fs.existsSync(path.join(f.root,'checker-started'))).toBe(false);
 }finally{f.close();}
});
