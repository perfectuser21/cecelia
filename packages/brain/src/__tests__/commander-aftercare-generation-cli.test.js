import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const script = new URL('../../scripts/commander-aftercare.mjs', import.meta.url).pathname;
const oldId = '11111111-2222-4333-8444-555555555555', newId = '22222222-2222-4333-8444-555555555555';
// 静态运输桩/authority代码，所有数据均通过独立JSON文件传递。
const adapterSource = `import fs from 'node:fs/promises';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
export function createAftercareAuthority({requestPath,prefix}) {
 const root=process.env.COMMANDER_AFTERCARE_DIR;
 return {
  async refreshContext(c) {let a=await read(root+'/authority.json');if(a.handoverAfterRetry&&await fs.stat(root+'/retried').then(()=>true,()=>false)){a={...a,escortId:'22222222-2222-4333-8444-555555555555',generation:2,operationId:'op2'};await fs.writeFile(root+'/authority.json',JSON.stringify(a));}return {state:a.state,operationId:a.operationId,generation:a.generation,context:{...c,escortId:a.escortId}};},
  async withGenerationFence(token, action) {
   const a=await read(root+'/authority.json');
   if(a.state!=='committed'||a.operationId!==token.operationId||a.generation!==token.generation||a.escortId!==token.context.escortId)throw Error('generation-stale');
   const r=await action();
   if(a.flipAfterFence===token.operation){await fs.writeFile(root+'/authority.json',JSON.stringify({...a,state:'pending'}));}
   return r;
  }
 };
}
`;
const cronSource = `#!/usr/bin/env node
const fs=require('node:fs'),root=process.env.COMMANDER_AFTERCARE_DIR;
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),a=read(root+'/authority.json'),p=root+'/escort-local-test',c=read(p+'.request.json');
const op=process.argv[3]; fs.appendFileSync(root+'/calls',JSON.stringify(process.argv.slice(2))+'\\n');
if(op==='run'&&!a.noAck)fs.writeFileSync(p+'.json',JSON.stringify({schema_version:1,run_tag:c.tag,host:c.host,escort_id:c.escortId,nonce:c.nonce,finalize_verified:true,status:'completed',actor:'fixture',at:new Date().toISOString(),facts:['terminal'],evidence:['fixture']}));
if(op==='run')fs.writeFileSync(root+'/retried','yes');
if(op==='disable')fs.writeFileSync(root+'/disabled','yes');
if(op==='enable')fs.rmSync(root+'/disabled',{force:true});
if(op==='rm')fs.writeFileSync(root+'/removed','yes');
const state=a.cancellationLoop&&fs.existsSync(root+'/disabled')?{lastRunStatus:'error',lastError:'Cron job disabled by operator.'}:{lastRunStatus:'ok',lastRunAtMs:Date.now()-10000,lastDurationMs:20000};
if(op==='list'&&fs.existsSync(root+'/removed')&&a.finalRemovalEvidence){const file=root+'/removal-reads',count=fs.existsSync(file)?Number(fs.readFileSync(file))+1:1;fs.writeFileSync(file,String(count));if(count>=3){console.log(a.finalRemovalEvidence==='unreadable'?'unreadable':JSON.stringify({jobs:[{id:'33333333-2222-4333-8444-555555555555',name:'escort-local-test'}]}));process.exit(0);}}
console.log(JSON.stringify({jobs:fs.existsSync(root+'/removed')?[]:[{id:a.escortId,name:'escort-local-test',agentId:'work-commander',sessionTarget:'session:escort-local-test',enabled:!fs.existsSync(root+'/disabled'),schedule:{kind:'every',everyMs:600000},state,...a.jobPatch}]}));
`;
async function fixture(options={}) {
 const root=await mkdtemp(join(tmpdir(),'aftercare-generation-')); let patches=0,stored;
 const server=createServer(async(req,res)=>{if(req.method==='PATCH'){patches++;let data='';for await(const x of req)data+=x;stored=JSON.parse(data).result;
  if(options.replaceLeaseDuringPatch){await writeFile(join(root,'escort-local-test.lock'),JSON.stringify({nonce:'future-nonce',workerId:'future-worker'}));await writeFile(join(root,'escort-local-test.result.json'),JSON.stringify({status:'future-result'}));}
 }res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result:stored}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const prefix=join(root,'escort-local-test'),requestPath=prefix+'.request.json';
 const context={taskId:oldId,escortId:oldId,tag:'test',host:'local',finalized:true,nonce:'old-nonce',generation:1,operationId:'op1',cancellationRetries:options.retries||0,requestedAt:new Date(Date.now()-(options.expired?1200001:1000)).toISOString(),startup:{summary:'original START',businessPid:123},brainUrl:'http://127.0.0.1:'+server.address().port};
 await writeFile(requestPath,JSON.stringify(context)); await writeFile(prefix+'.lock',JSON.stringify({nonce:options.foreign?'foreign':context.nonce,workerId:'original-lease'}));
 await writeFile(prefix+'.json',JSON.stringify({schema_version:1,run_tag:'test',host:'local',escort_id:oldId,nonce:context.nonce,finalize_verified:true,status:'completed',actor:'fixture',at:new Date().toISOString(),facts:['old terminal'],evidence:['old ack']}));
 await writeFile(join(root,'authority.json'),JSON.stringify({state:options.pending?'pending':'committed',generation:2,operationId:'op2',escortId:newId,...options}));
 if(options.cancellationLoop)await writeFile(join(root,'disabled'),'yes');
 const module=join(root,'authority.mjs'),bin=join(root,'cron'); await writeFile(module,adapterSource);await writeFile(bin,cronSource,{mode:0o755});await writeFile(join(root,'calls'),'');
 const env={...process.env,COMMANDER_AFTERCARE_DIR:root,COMMANDER_OPENCLAW_BIN:bin,COMMANDER_AFTERCARE_AUTHORITY_MODULE:module};
 const run=(lease='original-lease',modulePath=module)=>execute(process.execPath,[script,'--worker',requestPath,'--lease',lease],{env:{...env,COMMANDER_AFTERCARE_AUTHORITY_MODULE:modulePath},timeout:10000});
 const enqueue=async()=>{await rm(prefix+'.lock');return new Promise((accept,reject)=>{let out='',err='';const child=spawn(process.execPath,[script,'--enqueue'],{env});child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>code?reject(Error(err)):accept(JSON.parse(out)));child.stdin.end(JSON.stringify(context));});};
 const json=p=>readFile(p,'utf8').then(JSON.parse);
 return {root,prefix,context,run,enqueue,json,patches:()=>patches,calls:()=>readFile(join(root,'calls'),'utf8'),dispose:async()=>{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}};
}
it('真实CLI显式adapter接班：归档旧ack/request、新nonce保原START/期限，天然finished receipt才注销',async()=>{
 const f=await fixture();try{await f.run();const c=await f.json(f.prefix+'.request.json'),r=await f.json(f.prefix+'.result.json');
  expect(r.status).toBe('retired');expect(c.escortId).toBe(newId);expect(c.nonce).not.toBe(f.context.nonce);expect(c.requestedAt).toBe(f.context.requestedAt);expect(c.startup).toEqual(f.context.startup);
  expect(await f.json(f.prefix+'.archive.op1.request.json')).toMatchObject(f.context);expect((await f.json(f.prefix+'.archive.op1.receipt.json')).nonce).toBe('old-nonce');
  expect(await f.calls()).toContain('"rm","'+newId+'"');expect(f.patches()).toBe(1);
 }finally{await f.dispose();}
});
for(const options of [{pending:true},{expired:true},{foreign:true}])it('真实CLI保留零mutate '+JSON.stringify(options),async()=>{
 const f=await fixture(options);try{await f.run().catch(()=>{});expect(f.patches()).toBe(0);expect(await f.calls()).not.toMatch(/"(?:run|disable|enable|rm)"/);
  expect((await f.json(f.prefix+'.request.json')).nonce).toBe('old-nonce');
  if(options.foreign)expect((await f.json(f.prefix+'.lock')).nonce).toBe('foreign');
 }finally{await f.dispose();}
});
it('真实CLI mutation await间authority换代，后续Brain/disable/rm皆拒',async()=>{
 const f=await fixture({flipAfterFence:'requestTick'});try{await f.run();expect(f.patches()).toBe(0);expect(await f.calls()).not.toMatch(/"(?:disable|rm)"/);}finally{await f.dispose();}
});
it('真实跨进程restart同op复用nonce与原20min deadline，不归档同代新request',async()=>{
 const f=await fixture({flipAfterFence:'persistContext'});try{
  await f.run();const first=await f.json(f.prefix+'.request.json');expect(first.escortId).toBe(newId);
  await writeFile(join(f.root,'authority.json'),JSON.stringify({state:'committed',generation:2,operationId:'op2',escortId:newId}));
  await writeFile(f.prefix+'.lock',JSON.stringify({nonce:first.nonce,workerId:'restart-lease'}));await f.run('restart-lease');
  const next=await f.json(f.prefix+'.request.json');expect(next.nonce).toBe(first.nonce);expect(next.requestedAt).toBe(f.context.requestedAt);expect(next.deadlineAt).toBe(first.deadlineAt);
  expect((await f.json(f.prefix+'.result.json')).status).toBe('retired');
 }finally{await f.dispose();}
});
it('Brain await间旧lease被替换，旧worker不写新result/删新lease',async()=>{
 const f=await fixture({replaceLeaseDuringPatch:true});try{await f.run();
  expect(await f.json(f.prefix+'.result.json')).toEqual({status:'future-result'});
  expect(await f.json(f.prefix+'.lock')).toEqual({nonce:'future-nonce',workerId:'future-worker'});
  expect(await f.calls()).not.toMatch(/"(?:disable|rm)"/);
 }finally{await f.dispose();}
});
it('旧worker凭旧token不能启动新代worker lease，即使同nonce',async()=>{
 const f=await fixture();try{await writeFile(f.prefix+'.lock',JSON.stringify({nonce:f.context.nonce,workerId:'foreign-worker'}));
  await expect(f.run()).rejects.toThrow();expect(f.patches()).toBe(0);expect(await f.calls()).toBe('');
  expect((await f.json(f.prefix+'.lock')).workerId).toBe('foreign-worker');
 }finally{await f.dispose();}
});
it('同owner跨restart原requestedAt已超20min，不run/patch/disable/rm',async()=>{
 const f=await fixture({expired:true,escortId:oldId,generation:1,operationId:'op1'});try{await f.run();expect(f.patches()).toBe(0);expect(await f.calls()).not.toMatch(/"(?:run|disable|enable|rm)"/);expect((await f.json(f.prefix+'.result.json')).status).toBe('retained');}finally{await f.dispose();}
});
it('真实进程恢复部分写入journal，复用固定nonce且归档旧证据',async()=>{
 const f=await fixture();try{
  const next={...f.context,escortId:newId,generation:2,operationId:'op2',nonce:'durable-recovery-nonce',deadlineAt:new Date(Date.parse(f.context.requestedAt)+1200000).toISOString()};
  const previous={...f.context,deadlineAt:next.deadlineAt},receipt=await f.json(f.prefix+'.json');
  await writeFile(f.prefix+'.transition.json',JSON.stringify({previous,next,receipt,lease:{nonce:f.context.nonce,workerId:'original-lease'}}));
  await writeFile(f.prefix+'.request.json',JSON.stringify(next)); // request已提交，lease尚旧。
  await f.run();expect((await f.json(f.prefix+'.request.json')).nonce).toBe('durable-recovery-nonce');expect((await f.json(f.prefix+'.result.json')).status).toBe('retired');
  expect((await f.json(f.prefix+'.archive.op1.receipt.json')).nonce).toBe('old-nonce');
 }finally{await f.dispose();}
});
it('取消恢复累计2次上限持久化，第二真实进程不能重置计数',async()=>{
 const f=await fixture({cancellationLoop:true,retries:1,escortId:oldId,generation:1,operationId:'op1'});try{
  await f.run();const c=await f.json(f.prefix+'.request.json');expect(await f.json(f.prefix+'.retry.json')).toMatchObject({count:2,requestedAt:f.context.requestedAt});expect(c.cancellationRetries).toBe(f.context.cancellationRetries);
  const before=await f.calls();expect(before.match(/"enable"/g)).toHaveLength(1);
  await writeFile(f.prefix+'.lock',JSON.stringify({nonce:c.nonce,workerId:'restart-lease'}));await f.run('restart-lease');
  expect((await f.calls()).match(/"enable"/g)).toHaveLength(1);expect((await f.json(f.prefix+'.result.json')).status).toBe('retained');
 }finally{await f.dispose();}
});
it('journal恢复不能覆改原START/PID事实',async()=>{
 const f=await fixture();try{
  const deadlineAt=new Date(Date.parse(f.context.requestedAt)+1200000).toISOString(),previous={...f.context,deadlineAt};
  const next={...previous,escortId:newId,generation:2,operationId:'op2',nonce:'new-nonce',startup:{summary:'forged START',businessPid:456}};
  await writeFile(f.prefix+'.request.json',JSON.stringify(previous));await writeFile(f.prefix+'.transition.json',JSON.stringify({previous,next,receipt:await f.json(f.prefix+'.json'),lease:{nonce:f.context.nonce,workerId:'original-lease'}}));
  await expect(f.run()).rejects.toThrow();expect((await f.json(f.prefix+'.request.json')).startup).toEqual(f.context.startup);expect(f.patches()).toBe(0);expect(await f.calls()).toBe('');
 }finally{await f.dispose();}
});
it('取消恢复预算跨换代及restart保持累计上限',async()=>{
 const f=await fixture({cancellationLoop:true,retries:1,escortId:oldId,generation:1,operationId:'op1',handoverAfterRetry:true});try{
  await f.run();const c=await f.json(f.prefix+'.request.json');expect(c.escortId).toBe(newId);expect(await f.json(f.prefix+'.retry.json')).toMatchObject({count:2,requestedAt:f.context.requestedAt});expect(c.cancellationRetries).toBe(f.context.cancellationRetries);
  await writeFile(f.prefix+'.lock',JSON.stringify({nonce:c.nonce,workerId:'restart-lease'}));const before=(await f.calls()).match(/"enable"/g)?.length||0;await f.run('restart-lease');expect((await f.calls()).match(/"enable"/g)?.length||0).toBe(before);
 }finally{await f.dispose();}
});
for(const expired of [false,true])it('实际enqueue传新worker lease且保既有期限 '+expired,async()=>{
 const f=await fixture(expired?{expired:true,escortId:oldId,generation:1,operationId:'op1'}:{});let child;
 try{child=await f.enqueue();expect(child.status).toBe('requested');
  const until=Date.now()+5000;let result;while(Date.now()<until){result=await f.json(f.prefix+'.result.json').catch(()=>null);if(result)break;await new Promise(r=>setTimeout(r,10));}
  expect(result?.status).toBe(expired?'retained':'retired');expect(result.requestedAt).toBe(f.context.requestedAt);
  expect(Date.parse(result.deadlineAt)).toBe(Date.parse(f.context.requestedAt)+1200000);if(expired)expect(f.patches()).toBe(0);
 }finally{if(child)try{process.kill(child.pid,'SIGTERM');}catch{}await f.dispose();}
});
for(const moduleValue of ['relative.mjs','incomplete'])it('实际CLI拒绝不完整/非绝对adapter，不能fallback '+moduleValue,async()=>{
 const f=await fixture();try{let p=moduleValue;if(moduleValue==='incomplete'){p=join(f.root,'bad.mjs');await writeFile(p,'export function createAftercareAuthority(){return {refreshContext:async()=>({state:"pending"})}}');}
  await expect(f.run('original-lease',p)).rejects.toThrow();expect(f.patches()).toBe(0);expect(await f.calls()).toBe('');expect((await f.json(f.prefix+'.request.json')).nonce).toBe('old-nonce');
 }finally{await f.dispose();}
});
it('adapter绝对路径含空格井号与引号经fileURL加载而不生成源码',async()=>{
 const f=await fixture();try{const p=join(f.root,"adapter # quote'.mjs");await writeFile(p,adapterSource);await f.run('original-lease',p);expect((await f.json(f.prefix+'.result.json')).status).toBe('retired');}finally{await f.dispose();}
});
for(const jobPatch of [{agentId:'foreign-agent'},{sessionTarget:'session:foreign'},
 {schedule:{kind:'every',everyMs:1}},{agentId:null},{sessionTarget:null},{schedule:{kind:'every'}}])it('实际CLI错/缺role字段拒绝零mutation '+JSON.stringify(jobPatch),async()=>{
 const f=await fixture({jobPatch});try{const out=await f.run();expect(JSON.parse(out.stdout).status).toBe('retained');expect(f.patches()).toBe(0);expect(await f.calls()).not.toMatch(/"(?:run|enable|disable|rm)"/);
  expect(await f.json(f.prefix+'.request.json')).toEqual(f.context);expect((await f.json(f.prefix+'.json')).nonce).toBe('old-nonce');
  for(const suffix of ['.transition.json','.archive.op1.request.json','.archive.op1.receipt.json','.result.json'])expect(await f.json(f.prefix+suffix).catch(()=>null)).toBe(null);
 }finally{await f.dispose();}
});
const invalidRoles=[{agentId:'foreign-agent'},{sessionTarget:'session:foreign'},{schedule:{kind:'every',everyMs:1}},
 {agentId:null},{sessionTarget:null},{schedule:{kind:'every'}}];
for(const jobPatch of invalidRoles)for(const halfWritten of [false,true])it('journal错/缺role保原件 '+JSON.stringify({jobPatch,halfWritten}),async()=>{
 const f=await fixture({jobPatch});try{
  const previous={...f.context,deadlineAt:new Date(Date.parse(f.context.requestedAt)+1200000).toISOString()},next={...previous,escortId:newId,generation:2,operationId:'op2',nonce:'durable-journal-nonce'};
  const receipt=await f.json(f.prefix+'.json'),lease=await f.json(f.prefix+'.lock'),journal={previous,next,receipt,lease},request=halfWritten?next:previous;
  await writeFile(f.prefix+'.request.json',JSON.stringify(request));await writeFile(f.prefix+'.transition.json',JSON.stringify(journal));await f.run().catch(()=>{});
  expect(await f.json(f.prefix+'.request.json')).toEqual(request);expect(await f.json(f.prefix+'.json')).toEqual(receipt);expect(await f.json(f.prefix+'.lock')).toEqual(lease);expect(await f.json(f.prefix+'.transition.json')).toEqual(journal);
  for(const suffix of ['.archive.op1.request.json','.archive.op1.receipt.json','.result.json'])expect(await f.json(f.prefix+suffix).catch(()=>null)).toBe(null);
  expect(f.patches()).toBe(0);expect(await f.calls()).not.toMatch(/"(?:run|enable|disable|rm)"/);
 }finally{await f.dispose();}
});
for(const jobPatch of invalidRoles)it('sameowner错/缺role禁止最终result写或lease删除 '+JSON.stringify(jobPatch),async()=>{
 const f=await fixture({jobPatch,escortId:oldId,generation:1,operationId:'op1'});try{const lease=await f.json(f.prefix+'.lock'),ack=await f.json(f.prefix+'.json');await f.run();
  expect(await f.json(f.prefix+'.request.json')).toEqual(f.context);expect(await f.json(f.prefix+'.json')).toEqual(ack);expect(await f.json(f.prefix+'.lock').catch(()=>null)).toEqual(lease);expect(await f.json(f.prefix+'.result.json').catch(()=>null)).toBe(null);
  expect(f.patches()).toBe(0);expect(await f.calls()).not.toMatch(/"(?:run|enable|disable|rm)"/);
 }finally{await f.dispose();}
});
for(const finalRemovalEvidence of ['unreadable','ambiguous'])it('retired最终list缺证保result/lease '+finalRemovalEvidence,async()=>{
 const f=await fixture({finalRemovalEvidence});try{await f.run();const c=await f.json(f.prefix+'.request.json');
  expect(await f.json(f.prefix+'.result.json').catch(()=>null)).toBe(null);expect((await f.json(f.prefix+'.lock').catch(()=>null))?.nonce).toBe(c.nonce);
 }finally{await f.dispose();}
});

for(const stage of ['legacy-normalized','raw-before-request','raw-archive-half'])it('旧无deadline journal恢复固定初始20min '+stage,async()=>{
 const f=await fixture();try{
  const deadlineAt=new Date(Date.parse(f.context.requestedAt)+1200000).toISOString();
  const previous=stage==='legacy-normalized'?{...f.context,deadlineAt}:f.context;
  const next={...previous,deadlineAt,escortId:newId,generation:2,operationId:'op2',nonce:'legacy-fixed-nonce'};
  const receipt=await f.json(f.prefix+'.json'),lease={nonce:f.context.nonce,workerId:'original-lease'};
  if(stage==='raw-archive-half')await writeFile(f.prefix+'.archive.op1.request.json',JSON.stringify(previous));
  await writeFile(f.prefix+'.transition.json',JSON.stringify({previous,next,receipt,lease}));
  await f.run();expect((await f.json(f.prefix+'.result.json')).status).toBe('retired');
  const request=await f.json(f.prefix+'.request.json');expect(request.nonce).toBe(next.nonce);expect(request.requestedAt).toBe(f.context.requestedAt);expect(request.deadlineAt).toBe(deadlineAt);expect(request.startup).toEqual(f.context.startup);
  expect(await f.json(f.prefix+'.archive.op1.request.json')).toEqual(previous);
 }finally{await f.dispose();}
});
for(const future of [false,true])it('旧无deadline journal不能改预算或未来初次时间 '+future,async()=>{
 const f=await fixture();try{const previous={...f.context,...(future?{requestedAt:new Date(Date.now()+60000).toISOString()}:{})},next={...previous,escortId:newId,generation:2,operationId:'op2',nonce:'fixed-nonce',deadlineAt:new Date(Date.parse(previous.requestedAt)+(future?1200000:2400000)).toISOString()};
  const journal={previous,next,receipt:await f.json(f.prefix+'.json'),lease:{nonce:f.context.nonce,workerId:'original-lease'}};await writeFile(f.prefix+'.request.json',JSON.stringify(previous));await writeFile(f.prefix+'.transition.json',JSON.stringify(journal));
  await expect(f.run()).rejects.toThrow();expect(await f.json(f.prefix+'.request.json')).toEqual(previous);expect(await f.json(f.prefix+'.transition.json')).toEqual(journal);expect(await f.calls()).toBe('');expect(f.patches()).toBe(0);
 }finally{await f.dispose();}
});
