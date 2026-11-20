import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
const brainRoot=path.resolve(import.meta.dirname,'../../..');
const bundleFiles=['scripts/native-agent/bundle.mjs','scripts/native-agent/config.mjs','scripts/native-agent/store.mjs','scripts/native-agent/process.mjs','scripts/native-agent/worker.mjs','scripts/native-agent/cli.mjs','scripts/coding-workflow/lib/codex-auth.mjs','src/orchestrator/activity-supervisor-state.cjs'];
const bundleDigest=root=>hash(JSON.stringify(bundleFiles.map(p=>[p,fs.existsSync(path.join(root,p))?hash(fs.readFileSync(path.join(root,p))):'missing']))));
const hash=x=>createHash('sha256').update(x).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(t,{timeout=10000,copyBundle=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-agent-test-'));fs.chmodSync(root,0o700);
 t.after(()=>{try{const launches=fs.readFileSync(path.join(root,'launches'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);for(const p of launches)try{process.kill(-p.pid,'SIGKILL');}catch{}}catch{}fs.rmSync(root,{recursive:true,force:true});});
 for(const d of ['home','auth','cwd','skills','state'])fs.mkdirSync(path.join(root,d),{mode:0o700});
 fs.writeFileSync(path.join(root,'auth/auth.json'),JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'fixture-native-account-a'}),{mode:0o600});
 const skill=path.join(root,'skills/SKILL.md');fs.writeFileSync(skill,'# Explicit fixture skill\n',{mode:0o600});
 const command=path.join(root,'fake-codex');
 fs.writeFileSync(command,`#!${process.execPath}
const fs=require('fs'),{spawn}=require('child_process');
let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>text+=x);
process.stdin.on('end',()=>{
 fs.appendFileSync(${JSON.stringify(path.join(root,'launches'))},JSON.stringify({pid:process.pid,argv:process.argv.slice(2),text,home:process.env.HOME,codex_home:process.env.CODEX_HOME,unsafe:process.env.OPENAI_API_KEY||process.env.NODE_OPTIONS||null})+'\\n');
 if(text.includes('MODE_HANG')){process.on('SIGTERM',()=>{});const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(path.join(root,'grandchild'))},String(c.pid));setInterval(()=>{},1000);return;}
 process.stdout.write(JSON.stringify({body:text,account:JSON.parse(fs.readFileSync(process.env.CODEX_HOME+'/auth.json')).OPENAI_API_KEY==='fixture-native-account-a'?'account-a':'wrong-account'}));
 if(text.includes('MODE_FAIL')){process.stderr.write('fixture deliberate failure');process.exitCode=7;}
});
`,{mode:0o755});
 let sourceRoot=brainRoot;if(copyBundle){sourceRoot=path.join(root,'bundle');for(const f of bundleFiles){const dest=path.join(sourceRoot,f);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});if(fs.existsSync(path.join(brainRoot,f)))fs.copyFileSync(path.join(brainRoot,f),dest);}}
 const cli=path.join(sourceRoot,'scripts/native-agent/cli.mjs');
 const config={bundle_sha256:bundleDigest(sourceRoot),protocol:'native-agent-config/v1',state_dir:path.join(root,'state'),profiles:[{tenant:'tenant-a',department:'department-a',role:'agent-a',account_ref:'account-a',codex_home:path.join(root,'auth'),auth_mode:'api-only',home:path.join(root,'home'),command,command_sha256:hash(fs.readFileSync(command)),cwd:path.join(root,'cwd'),models:['fixture-model'],thinking:['high'],timeout_ms:timeout,terminate_grace_ms:100,skill_roots:[path.join(root,'skills')],skills:{'skill-a':{path:skill,sha256:hash(fs.readFileSync(skill))}}}]};
 const file=path.join(root,'config.json');fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});
 const request=(prompt='fixture complete body')=>({protocol:'native-agent/v1',action:'start',tenant:'tenant-a',department:'department-a',role:'agent-a',account_ref:'account-a',task_id:randomUUID(),run_id:randomUUID(),request_nonce:randomUUID(),input_digest:hash(prompt),prompt,model:'fixture-model',thinking:'high',skill_ids:['skill-a'],timeout_ms:timeout,deadline_ms:Date.now()+timeout});
 const control=(r,action)=>Object.fromEntries(Object.entries({...r,action}).filter(([k])=>!['prompt','model','thinking','skill_ids','timeout_ms','deadline_ms'].includes(k)));
 const call=r=>new Promise(resolve=>{const c=spawn(process.execPath,[cli,file,config.bundle_sha256],{env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,OPENAI_API_KEY:'parent-must-not-leak'},stdio:['pipe','pipe','pipe']});let out='',err='';c.stdout.on('data',x=>out+=x);c.stderr.on('data',x=>err+=x);c.on('exit',code=>{let value;try{value=JSON.parse(out);}catch{}resolve({code,value,out,err});});c.stdin.on('error',()=>{});c.stdin.end(JSON.stringify(r));});
 const launches=()=>{try{return fs.readFileSync(path.join(root,'launches'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}catch{return [];}};
 const poll=async(r,predicate)=>{for(let n=0;n<120;n++){const x=await call(control(r,'inspect'));assert.equal(x.code,0,x.err+x.out);if(predicate(x.value))return x.value;await sleep(50);}throw Error('native result not confirmed');};
 return {root,file,config,sourceRoot,request,control,call,poll,launches,save:()=>fs.writeFileSync(file,JSON.stringify(config),{mode:0o600})};
}
test('真实CLI将完整长正文送stdin、固定账号/HOME，并持久保存本次child退出结果',async t=>{
 const f=fixture(t),r=f.request('完整原文\n'+('do not truncate; '.repeat(8000)));const start=await f.call(r);
 assert.equal(start.code,0,start.err+start.out);assert.equal(start.value.run_id,r.run_id);
 const done=await f.poll(r,v=>v?.launch_state==='stopped');assert.equal(done.status,'completed');assert.equal(done.execution_stopped,true);
 assert.equal(done.input_digest,r.input_digest);assert.equal(done.result.child_exited,true);assert.equal(done.result.exit_code,0);
 assert.equal(JSON.parse(done.result.stdout).body,r.prompt);assert.equal(JSON.parse(done.result.stdout).account,'account-a');
 const [actual]=f.launches();assert.equal(actual.text,r.prompt);assert.equal(actual.home,f.config.profiles[0].home);assert.equal(actual.codex_home,f.config.profiles[0].codex_home);assert.equal(actual.unsafe,null);
 assert.ok(actual.argv.every(x=>!x.includes('do not truncate')));assert.ok(done.frozen.config_digest);assert.ok(done.frozen.source_digest);
});
test('并发与响应丢失后重放start只inspect原run，不启动第二个CLI',async t=>{
 const f=fixture(t),r=f.request();await Promise.all([f.call(r),f.call(r),f.call(r)]);
 await f.poll(r,v=>v?.launch_state==='stopped');const replay=await f.call(r);assert.equal(replay.code,0,replay.err);
 assert.equal(f.launches().length,1);const conflict=await f.call({...r,prompt:'different',input_digest:hash('different')});assert.notEqual(conflict.code,0);assert.equal(f.launches().length,1);
});
for(const [field,value] of [['account_ref','other-account'],['model','other-model'],['thinking','low'],['skill_ids',['missing-skill']],['command','/bin/sh']])test(`未绑定输入${field}零启动且不自动换账号`,async t=>{
 const f=fixture(t),r={...f.request(),[field]:value};const x=await f.call(r);assert.notEqual(x.code,0);assert.equal(f.launches().length,0);assert.ok(x.value?.error);
});
test('非零真实child只记录failed，不能伪装completed',async t=>{const f=fixture(t),r=f.request('MODE_FAIL');await f.call(r);const d=await f.poll(r,v=>v?.launch_state==='stopped');assert.equal(d.status,'failed');assert.equal(d.result.exit_code,7);assert.match(d.result.stderr,/deliberate failure/);});
for(const mode of ['cancel','timeout'])test(`${mode}真实TERM到KILL终止原CLI及忽略TERM孙进程，不冒称外部业务撤销`,async t=>{
 const f=fixture(t,{timeout:mode==='timeout'?1000:10000}),r=f.request('MODE_HANG');await f.call(r);await f.poll(r,v=>v?.launch_state==='running');
 for(let n=0;n<60&&!fs.existsSync(path.join(f.root,'grandchild'));n++)await sleep(20);
 if(mode==='cancel')await f.call(f.control(r,'cancel'));
 const d=await f.poll(r,v=>v?.launch_state==='stopped');assert.equal(d.status,mode==='cancel'?'cancelled':'timed_out');assert.equal(d.result.child_exited,true);assert.equal(d.execution_stopped,true);assert.equal(d.termination_scope,'known_process_group');
 const pid=Number(fs.readFileSync(path.join(f.root,'grandchild')));const ps=spawnSync('ps',['-p',String(pid),'-o','stat='],{encoding:'utf8'});assert.ok(ps.status!==0||/^\s*Z/.test(ps.stdout),'grandchild remains live');assert.notEqual(d.external_effects_reverted,true);
});
test('配置/命令/技能漂移均拒绝，原run不能被新配置重新认领',async t=>{
 const f=fixture(t),r=f.request();await f.call(r);await f.poll(r,v=>v?.launch_state==='stopped');f.config.profiles[0].thinking=['high','medium'];f.save();const x=await f.call(f.control(r,'inspect'));assert.notEqual(x.code,0);assert.equal(f.launches().length,1);
 const g=fixture(t);fs.appendFileSync(g.config.profiles[0].command,'\n// command drift');assert.notEqual((await g.call(g.request())).code,0);assert.equal(g.launches().length,0);
 const h=fixture(t);fs.appendFileSync(h.config.profiles[0].skills['skill-a'].path,'\nskill drift');assert.notEqual((await h.call(h.request())).code,0);assert.equal(h.launches().length,0);
});
test('world-readable配置和不可用认证均拒绝且不读取其它账号',async t=>{
 const f=fixture(t);fs.chmodSync(f.file,0o644);assert.notEqual((await f.call(f.request())).code,0);assert.equal(f.launches().length,0);
 const g=fixture(t);fs.unlinkSync(path.join(g.root,'auth/auth.json'));assert.notEqual((await g.call(g.request())).code,0);assert.equal(g.launches().length,0);
});
for(const birth of ['not-the-recorded-process',null])test(`监督PID复用或身份unknown不终止原外进程、不伪造成功停止：${birth}`,async t=>{
 const f=fixture(t),r=f.request('MODE_HANG');await f.call(r);await f.poll(r,v=>v?.launch_state==='running');
 const file=path.join(f.root,'state',r.run_id,'state.json'),state=JSON.parse(fs.readFileSync(file));state.worker.birth=birth;fs.writeFileSync(file,JSON.stringify(state),{mode:0o600});
 const reply=await f.call(f.control(r,'cancel'));assert.equal(reply.value?.launch_state,'unknown');assert.equal(reply.value?.execution_stopped,false);
 assert.equal(fs.existsSync(path.join(f.root,'state',r.run_id,'cancel.json')),false);
 assert.doesNotThrow(()=>process.kill(f.launches()[0].pid,0));
});

test('真实发布bundle源码字节漂移在spawn前拒绝，不能只echo声明哈希',async t=>{
 const f=fixture(t,{copyBundle:true});fs.appendFileSync(path.join(f.sourceRoot,'scripts/native-agent/worker.mjs'),'\n// unreviewed drift\n');
 const x=await f.call(f.request());assert.notEqual(x.code,0);assert.ok(x.value?.error);assert.equal(f.launches().length,0);
});
