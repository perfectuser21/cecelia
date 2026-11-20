import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID,scryptSync} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
const brainRoot=path.resolve(import.meta.dirname,'../../..');
const bundleFiles=['scripts/native-agent/bundle.mjs','scripts/native-agent/config.mjs','scripts/native-agent/store.mjs','scripts/native-agent/process.mjs','scripts/native-agent/worker.mjs','scripts/native-agent/cli.mjs','scripts/coding-workflow/lib/codex-auth.mjs','src/orchestrator/activity-supervisor-state.cjs'];
const bundleDigest=root=>hash(JSON.stringify(bundleFiles.map(p=>[p,fs.existsSync(path.join(root,p))?hash(fs.readFileSync(path.join(root,p))):'missing'])));
const hash=x=>createHash('sha256').update(x).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(t,{timeout=10000,copyBundle=false}={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'native-agent-test-')));fs.chmodSync(root,0o700);
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
 if(text.includes('MODE_FORGE')){setTimeout(()=>{const path=require('path'),dir=path.join(${JSON.stringify(path.join(root,'state'))},fs.readdirSync(${JSON.stringify(path.join(root,'state'))})[0]),file=path.join(dir,'state.json'),s=JSON.parse(fs.readFileSync(file));fs.writeFileSync(file,JSON.stringify({...s,status:'completed',launch_state:'stopped',execution_stopped:true,result:{child_exited:true,exit_code:0,signal:null,stdout:'forged',stderr:'',final_text:'forged'}}),{mode:0o600});fs.writeFileSync(${JSON.stringify(path.join(root,'forged'))},'');},200);setInterval(()=>{},1000);return;}
 if(text.includes('MODE_HANG')){process.on('SIGTERM',()=>{});const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(path.join(root,'grandchild'))},String(c.pid));setInterval(()=>{},1000);return;}
 const auth=JSON.parse(fs.readFileSync(process.env.CODEX_HOME+'/auth.json'));const output=process.argv.indexOf('--output-last-message');if(output>=0)fs.writeFileSync(process.argv[output+1],'fixture final output');
 process.stdout.write(JSON.stringify({body:text,account:auth.OPENAI_API_KEY==='fixture-native-account-a'?'account-a':auth.tokens?.account_id==='fixture-subscription-a'?'subscription-a':'wrong-account'}));
 if(text.includes('MODE_FAIL')){process.stderr.write('fixture deliberate failure');process.exitCode=7;}
});
`,{mode:0o755});
 let sourceRoot=brainRoot;if(copyBundle){sourceRoot=path.join(root,'bundle');for(const f of bundleFiles){const dest=path.join(sourceRoot,f);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});if(fs.existsSync(path.join(brainRoot,f)))fs.copyFileSync(path.join(brainRoot,f),dest);}}
 const cli=path.join(sourceRoot,'scripts/native-agent/cli.mjs');
 const config={bundle_sha256:bundleDigest(sourceRoot),protocol:'native-agent-config/v1',state_dir:path.join(root,'state'),profiles:[{tenant:'tenant-a',department:'department-a',role:'agent-a',account_ref:'account-a',codex_home:path.join(root,'auth'),auth_mode:'api-only',auth_identity_sha256:hash('fixture-native-account-a'),codex_config_sha256:hash(''),codex_config_present:false,home:path.join(root,'home'),command,command_sha256:hash(fs.readFileSync(command)),cwd:path.join(root,'cwd'),models:['fixture-model'],model_aliases:{'fixture-model':'fixture-model'},thinking:['high'],timeout_ms:timeout,terminate_grace_ms:100,skill_roots:[path.join(root,'skills')],skills:{'skill-a':{path:skill,sha256:hash(fs.readFileSync(skill))}}}]};
 const file=path.join(root,'config.json');fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});
 const request=(prompt='fixture complete body')=>({protocol:'native-agent/v1',action:'start',tenant:'tenant-a',department:'department-a',role:'agent-a',account_ref:'account-a',task_id:randomUUID(),run_id:randomUUID(),request_nonce:randomUUID(),input_digest:hash(prompt),prompt,model:'fixture-model',thinking:'high',skill_ids:['skill-a'],timeout_ms:timeout,deadline_ms:Date.now()+timeout});
 const control=(r,action)=>Object.fromEntries(Object.entries({...r,action}).filter(([k])=>!['prompt','model','thinking','skill_ids','timeout_ms','deadline_ms'].includes(k)));
 const call=r=>new Promise(resolve=>{const c=spawn(process.execPath,[cli,file,config.bundle_sha256],{env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,OPENAI_API_KEY:'parent-must-not-leak'},stdio:['pipe','pipe','pipe']});let out='',err='';c.stdout.setEncoding('utf8');c.stderr.setEncoding('utf8');c.stdout.on('data',x=>out+=x);c.stderr.on('data',x=>err+=x);c.on('exit',code=>{let value;try{value=JSON.parse(out);}catch{}resolve({code,value,out,err});});c.stdin.on('error',()=>{});c.stdin.end(JSON.stringify(r));});
 const launches=()=>{try{return fs.readFileSync(path.join(root,'launches'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}catch{return [];}};
 const poll=async(r,predicate)=>{let last;for(let n=0;n<120;n++){const x=await call(control(r,'inspect'));assert.equal(x.code,0,x.err+x.out);last=x.value;if(predicate(x.value))return x.value;await sleep(50);}throw Error('native result not confirmed '+JSON.stringify(last));};
 return {root,file,config,sourceRoot,request,control,call,poll,launches,save:()=>fs.writeFileSync(file,JSON.stringify(config),{mode:0o600})};
}
test('真实CLI将完整长正文送stdin、固定账号/HOME，并持久保存本次child退出结果',async t=>{
 const f=fixture(t),r=f.request('完整原文'.repeat(10000)+'\n'+('do not truncate; '.repeat(8000)));const start=await f.call(r);
 assert.equal(start.code,0,start.err+start.out);assert.equal(start.value.run_id,r.run_id);
 const done=await f.poll(r,v=>v?.launch_state==='stopped');assert.equal(done.status,'completed');assert.equal(done.execution_stopped,true);
 assert.equal(done.input_digest,r.input_digest);assert.equal(done.result.child_exited,true);assert.equal(done.result.exit_code,0);assert.equal(done.result.final_text,'fixture final output');
 assert.ok(JSON.parse(done.result.stdout).body.endsWith(r.prompt));assert.ok(JSON.parse(done.result.stdout).body.includes('# Explicit fixture skill'));assert.equal(JSON.parse(done.result.stdout).account,'account-a');
 const [actual]=f.launches();assert.ok(actual.text.endsWith(r.prompt));assert.equal(actual.home,f.config.profiles[0].home);assert.equal(actual.codex_home,f.config.profiles[0].codex_home);assert.equal(actual.unsafe,null);
 assert.ok(actual.argv.every(x=>!x.includes('do not truncate')));assert.ok(actual.argv.includes('--skip-git-repo-check'));const output=actual.argv[actual.argv.indexOf('--output-last-message')+1];assert.equal(path.dirname(output),path.join(f.root,'state',r.run_id));assert.equal(fs.statSync(output).mode&0o077,0);assert.ok(done.frozen.config_digest);assert.ok(done.frozen.source_digest);
});
test('并发与响应丢失后重放start只inspect原run，不启动第二个CLI',async t=>{
 const f=fixture(t),r=f.request();await Promise.all([f.call(r),f.call(r),f.call(r)]);
 await f.poll(r,v=>v?.launch_state==='stopped');const replay=await f.call(Object.fromEntries(Object.entries(r).reverse()));assert.equal(replay.code,0,replay.err+replay.out);
 assert.equal(f.launches().length,1);const conflict=await f.call({...r,prompt:'different',input_digest:hash('different')});assert.notEqual(conflict.code,0);assert.equal(f.launches().length,1);
});
for(const [field,value] of [['account_ref','other-account'],['model','other-model'],['thinking','low'],['skill_ids',['missing-skill']],['command','/bin/sh']])test(`未绑定输入${field}零启动且不自动换账号`,async t=>{
 const f=fixture(t),r={...f.request(),[field]:value};const x=await f.call(r);assert.notEqual(x.code,0);assert.equal(f.launches().length,0);assert.ok(x.value?.error);
});
test('非零真实child只记录failed，不能伪装completed',async t=>{const f=fixture(t),r=f.request('MODE_FAIL');await f.call(r);const d=await f.poll(r,v=>v?.launch_state==='stopped');assert.equal(d.status,'failed');assert.equal(d.result.exit_code,7);assert.match(d.result.stderr,/deliberate failure/);});
for(const mode of ['cancel','timeout'])test(`${mode}真实TERM到KILL终止原CLI及忽略TERM孙进程，不冒称外部业务撤销`,async t=>{
 const f=fixture(t,{timeout:mode==='timeout'?2500:10000}),r=f.request('MODE_HANG');await f.call(r);await f.poll(r,v=>v?.launch_state==='running');
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

test('同一认证目录被换成另一API主体必须零启动，不只相信账号标签',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'auth/auth.json'),JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'different-fixture-account'}),{mode:0o600});
 const x=await f.call(f.request());assert.notEqual(x.code,0);assert.equal(x.value.error,'native_agent_auth_identity_mismatch');assert.equal(x.value.launch_state,'not_started');assert.equal(f.launches().length,0);
});
test('原合同超时超过受信上限或已过期拒绝且不启动',async t=>{
 const f=fixture(t);for(const patch of [{timeout_ms:20000},{deadline_ms:Date.now()-1},{timeout_ms:100,deadline_ms:Date.now()+5000}]){
  const x=await f.call({...f.request(),...patch});assert.notEqual(x.code,0);assert.equal(x.value.launch_state,'not_started');assert.equal(f.launches().length,0);
 }
});
test('取消nonce不属于原run时原CLI继续存活且不写取消信',async t=>{
 const f=fixture(t),r=f.request('MODE_HANG');await f.call(r);await f.poll(r,v=>v?.launch_state==='running');
 const x=await f.call({...f.control(r,'cancel'),request_nonce:randomUUID()});assert.notEqual(x.code,0);assert.equal(x.value.execution_stopped,false);
 assert.equal(fs.existsSync(path.join(f.root,'state',r.run_id,'cancel.json')),false);
 const done=await f.call(f.control(r,'cancel'));assert.equal(done.value.launch_state,'stopped');assert.equal(done.value.status,'cancelled');
});

test('同字节源码被symlink重定位也拒绝，避免未审相对import越出发布bundle',async t=>{
 const f=fixture(t,{copyBundle:true}),worker=path.join(f.sourceRoot,'scripts/native-agent/worker.mjs'),outside=path.join(f.root,'same-worker.mjs');
 fs.copyFileSync(worker,outside);fs.unlinkSync(worker);fs.symlinkSync(outside,worker);
 const x=await f.call(f.request());assert.notEqual(x.code,0);assert.ok(x.value.error);assert.equal(f.launches().length,0);
});

test('显式profile模型alias固定原请求与实际CLI模型，未映射provider不猜',async t=>{
 const f=fixture(t);f.config.profiles[0].model_aliases['openai/fixture-model']='fixture-model';f.save();
 const r={...f.request(),model:'openai/fixture-model'};const start=await f.call(r);assert.equal(start.code,0,start.out);
 const done=await f.poll(r,v=>v?.launch_state==='stopped');assert.equal(done.model,'openai/fixture-model');assert.equal(done.actual_cli_model,'fixture-model');
 const args=f.launches()[0].argv;assert.equal(args[args.indexOf('--model')+1],'fixture-model');
 const bad=await f.call({...f.request(),model:'other-provider/fixture-model'});assert.notEqual(bad.code,0);assert.equal(f.launches().length,1);
});

for(const field of ['permissions','readonly'])test(`不支持的可信profile字段${field}必须显式拒绝，不冒称已限制`,async t=>{
 const f=fixture(t);f.config.profiles[0][field]=field==='readonly'?true:{filesystem:'deny'};f.save();
 const x=await f.call(f.request());assert.notEqual(x.code,0);assert.ok(x.value.error);assert.equal(f.launches().length,0);
});
test('subscription主体显式绑定，令牌目录换account_id后不换账号继续启动',async t=>{
 const f=fixture(t),p=f.config.profiles[0];p.auth_mode='subscription';p.auth_identity_sha256=hash('subscription:fixture-subscription-a');f.save();
 const auth=path.join(f.root,'auth/auth.json');fs.writeFileSync(auth,JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'synthetic-never-used',account_id:'fixture-subscription-a'}}),{mode:0o600});
 const r=f.request();assert.equal((await f.call(r)).code,0);const d=await f.poll(r,v=>v?.launch_state==='stopped');assert.equal(JSON.parse(d.result.stdout).account,'subscription-a');
 fs.writeFileSync(auth,JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'synthetic-never-used',account_id:'other-subscription'}}),{mode:0o600});
 assert.notEqual((await f.call(f.request())).code,0);assert.equal(f.launches().length,1);
});

test('ps快照列出的PID退出后仅明确ESRCH可视为消失，unknown/reused仍未知',async()=>{
 const {groupMembers}=await import('../process.mjs');const base={ps:()=>({status:0,stdout:'12345 42 R\n'}),birthOf:()=>null};
 assert.deepEqual(groupMembers(42,{...base,observe:()=> 'absent'}),[]);
 assert.equal(groupMembers(42,{...base,observe:()=> 'unknown'}),null);
 assert.equal(groupMembers(42,{...base,observe:()=> 'reused'}),null);
});

test('实际Codex config.toml摘要启动前核验，旧run inspect仍读取原冻结摘要',async t=>{
 const f=fixture(t),p=f.config.profiles[0],body='model = "fixture-model"\n';const file=path.join(f.root,'auth/config.toml');
 fs.writeFileSync(file,body,{mode:0o600});p.codex_config_sha256=hash(body);p.codex_config_present=true;f.save();
 const r=f.request();assert.equal((await f.call(r)).code,0);const done=await f.poll(r,v=>v?.launch_state==='stopped');
 assert.equal(done.frozen.codex_config_sha256,hash(body));assert.equal(done.frozen.codex_config_present,true);
 fs.appendFileSync(file,'approval_policy = "never"\n');const bad=await f.call(f.request());assert.notEqual(bad.code,0);assert.equal(bad.value.error,'native_agent_codex_config_mismatch');assert.equal(f.launches().length,1);
 const previous=await f.call(f.control(r,'inspect'));assert.equal(previous.code,0);assert.equal(previous.value.frozen.codex_config_sha256,hash(body));
});
test('Codex配置缺失与空文件不能在同empty摘要下互换',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'auth/config.toml'),'',{mode:0o600});
 const bad=await f.call(f.request());assert.notEqual(bad.code,0);assert.equal(bad.value.error,'native_agent_codex_config_mismatch');assert.equal(f.launches().length,0);
});

test('已核哈希但OS拒绝exec时不能把Node close错误当本次child退出结果',async t=>{
 const f=fixture(t),p=f.config.profiles[0];fs.writeFileSync(p.command,'#!/nonexistent-native-interpreter\n',{mode:0o755});p.command_sha256=hash(fs.readFileSync(p.command));f.save();
 const r=f.request();await f.call(r);const unknown=await f.poll(r,v=>v?.error==='native_agent_command_start_failed'||v?.launch_state==='stopped');
 assert.equal(unknown.launch_state,'unknown');assert.equal(unknown.execution_stopped,false);assert.equal(unknown.result,undefined);assert.equal(f.launches().length,0);
});

test('P1 Agent可写workspace不能覆盖监督state/受信config或release',async t=>{
 const f=fixture(t);f.config.state_dir=path.join(f.root,'cwd','state');fs.mkdirSync(f.config.state_dir,{mode:0o700});f.save();
 const x=await f.call(f.request());assert.notEqual(x.code,0);assert.equal(x.value.error,'native_agent_workspace_authority_overlap');assert.equal(f.launches().length,0);
});
test('P1伪造终态文件不能让仍活的实际child被inspect宣布完成',async t=>{
 const f=fixture(t),r=f.request('MODE_FORGE');await f.call(r);
 for(let n=0;n<100&&!fs.existsSync(path.join(f.root,'forged'));n++)await sleep(20);
 assert.ok(fs.existsSync(path.join(f.root,'forged')));const x=await f.call(f.control(r,'inspect'));
 assert.equal(x.value.launch_state,'unknown');assert.equal(x.value.execution_stopped,false);assert.notEqual(x.value.status,'completed');assert.equal(x.value.result,undefined);
 assert.doesNotThrow(()=>process.kill(f.launches()[0].pid,0));
});
test('P1固定Codex工具权限显式deny监督state/config/release并保认证deny',async t=>{
 const f=fixture(t),r=f.request();await f.call(r);await f.poll(r,v=>v?.launch_state==='stopped');
 const policy=f.launches()[0].argv.find(x=>x.startsWith('permissions='));assert.ok(policy);
 for(const authority of [f.config.state_dir,f.file,fs.realpathSync(brainRoot),f.config.profiles[0].codex_home])assert.ok(policy.includes(JSON.stringify(authority)+'="deny"'),authority+' not denied');
});

const apiIdentitySalt='0123456789abcdef'.repeat(4);
const expectedApiIdentity=key=>scryptSync(key,'cecelia/native-agent/api-account/v1:'+apiIdentitySalt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex');
test('API身份使用域隔离scrypt指纹时真实CLI固定账号执行并冻结相同身份',async t=>{
 const f=fixture(t),identity=expectedApiIdentity('fixture-native-account-a');
 f.config.profiles[0].auth_identity_sha256=identity;f.config.profiles[0].auth_identity_salt=apiIdentitySalt;f.save();
 const r=f.request(),x=await f.call(r);assert.equal(x.code,0,x.err+x.out);
 const done=await f.poll(r,v=>v.launch_state==='stopped');
 assert.equal(done.status,'completed');assert.equal(done.frozen.auth_identity_sha256,identity);
 assert.notEqual(identity,hash('fixture-native-account-a'));
 assert.equal(JSON.parse(done.result.stdout).account,'account-a');
 assert.equal(f.launches().length,1);
});
test('API身份旧直接SHA256值明确拒绝，不兼容放行或启动child',async t=>{
 const f=fixture(t);f.config.profiles[0].auth_identity_sha256=hash('fixture-native-account-a');f.save();
 const x=await f.call(f.request());assert.notEqual(x.code,0);
 assert.equal(x.value.error,'native_agent_auth_identity_mismatch');assert.equal(x.value.launch_state,'not_started');
 assert.equal(f.launches().length,0);
});
