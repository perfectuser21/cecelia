import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareHostTools,createHostToolCaller,hostToolsArgs,hostToolsAreQuiescent} from '../skill-tools-mcp.mjs';
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
async function assertStopped(pid){
 const deadline=Date.now()+2000;
 while(Date.now()<deadline){
  try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')return;throw e;}
  // Linux僵尸已退出但等待init回收，不能把它当作仍执行的工具。
  if(process.platform==='linux'){try{if(/\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`,'utf8')))return;}catch(e){if(e.code==='ENOENT')return;throw e;}}
  await new Promise(r=>setTimeout(r,20));
 }
 assert.fail(`工具子孙进程未在2s内退出: ${pid}`);
}
function fixture(t,source){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'host-tools-test-'));t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
 fs.writeFileSync(path.join(cwd,'tool.mjs'),source??`console.log(JSON.stringify({state:'terminal',result:{exit_code:0},secret:'FAKE_SECRET',stdout:'FAKE_SECRET',stderr:'FAKE_SECRET'}))`);
 const inputFile=path.join(cwd,'activity-input.json'),identity={task_id:'task',run_id:'run',action_id:'action',attempt:1};
 fs.writeFileSync(inputFile,JSON.stringify({identity,activity_key:'collect'}));
 const options={config:{command:process.execPath,command_sha256:hash(process.execPath),entry:'tool.mjs',kinds:['phone'],timeout_ms:2000,response_paths:['state','result.exit_code']},cwd,files:{'tool.mjs':hash(path.join(cwd,'tool.mjs'))},identity,activityKey:'collect',inputFile,directory:path.join(cwd,'host-private'),deadlineMs:Date.now()+30000};
 return {cwd,options,binding:prepareHostTools(options)};
}
test('冻结工具宿主调用且只返回审阅过的JSON字段，不暴露原stdout/stderr',async t=>{
 const {binding}=fixture(t),caller=createHostToolCaller(binding);const a={kind:'phone',action_name:'one',args:['read']};
 const out=await caller.call(a);assert.equal(out.output.state,'terminal');assert.equal(out.output['result.exit_code'],0);assert(!JSON.stringify(out).includes('FAKE_SECRET'));
 const prior=await caller.call(a);assert.deepEqual(prior,out);await assert.rejects(caller.call({...a,args:['different']}),/host_tool_action_conflict/);
});
test('收尾读回核对同一动作已完成的宿主工具回执，在途锁和损坏的原件均不放行',async t=>{
 const {binding,cwd,options}=fixture(t);
 const directory=path.join(cwd,'host-tools');
 const scoped=prepareHostTools({...options,directory});
 fs.chmodSync(options.inputFile,0o600);
 fs.writeFileSync(path.join(cwd,'host-tools-binding.json'),JSON.stringify(scoped),{mode:0o600});
 const out=await createHostToolCaller(scoped).call({kind:'phone',action_name:'native',args:['read']});
 const authorized=()=>hostToolsAreQuiescent(cwd,binding.identity,binding.deadline_ms);
 assert(authorized());
 assert(!hostToolsAreQuiescent(cwd,{...binding.identity,action_id:'other'},binding.deadline_ms));
 fs.writeFileSync(out.evidence_ref+'.lock','',{mode:0o600});
 assert(!authorized());
 fs.unlinkSync(out.evidence_ref+'.lock');
 fs.appendFileSync(out.evidence_ref+'.stdout','tampered');
 assert(!authorized());
});
test('每次调用核验固定身份、所有文件hash与deadline，拒绝任意command/env/路径',async t=>{
 const {binding,cwd}=fixture(t),caller=createHostToolCaller(binding),a={kind:'phone',action_name:'one',args:[]};
 await assert.rejects(caller.call({...a,command:'/bin/sh'}),/host_tool_request_invalid/);
 fs.writeFileSync(path.join(cwd,'tool.mjs'),'changed');await assert.rejects(caller.call(a),/host_tool_source_drift/);
 const second=fixture(t);fs.writeFileSync(second.options.inputFile,JSON.stringify({identity:{...second.options.identity,run_id:'wrong'},activity_key:'collect'}));await assert.rejects(createHostToolCaller(second.binding).call(a),/host_tool_identity_drift/);
 const third=fixture(t);await assert.rejects(createHostToolCaller({...third.binding,deadline_ms:Date.now()-1}).call(a),/host_tool_deadline/);
});
test('timeout杀掉工具进程组，保留unknown且不重放',async t=>{
 const {binding,cwd}=fixture(t,`import fs from 'node:fs';import {spawn} from 'node:child_process';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);fs.writeFileSync('pids.json',JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`);
 const caller=createHostToolCaller({...binding,timeout_ms:1500}),a={kind:'phone',action_name:'timeout',args:[]};
 await assert.rejects(caller.call(a),/host_tool_unknown/);for(const pid of JSON.parse(fs.readFileSync(path.join(cwd,'pids.json'))))await assertStopped(pid);
 await assert.rejects(caller.call(a),/host_tool_unknown/);
});
test('stdio MCP只注册固定工具参数，不放开Codex认证配置',t=>{
 const {binding}=fixture(t),args=hostToolsArgs('/fixed/binding.json','a'.repeat(64),binding.directory,'/fixed/auth');
 assert(args.some(x=>x.startsWith('mcp_servers.commander_host_tools.command=')));
 assert(!args.some(x=>x.includes('danger-full-access')));assert(args.some(x=>x.includes('filesystem')&&x.includes('deny')));
 assert.throws(()=>prepareHostTools({...fixture(t).options,config:{...binding.config,entry:'../escape'}}),/host_tool_config_invalid/);
});
for(const mode of ['EOF','SIGTERM'])test(`stdio ${mode}不执行已排队动作并杀掉当前子孙，unknown不能洗白`,async t=>{
 const {spawn}=await import('node:child_process');const {once}=await import('node:events');
 const {binding,cwd}=fixture(t,`import fs from 'node:fs';import {spawn} from 'node:child_process';fs.appendFileSync('starts',process.argv[3]+'\\n');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);fs.writeFileSync('pids.json',JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`);
 const file=path.join(cwd,'binding.json');fs.writeFileSync(file,JSON.stringify(binding));
 const server=spawn(process.execPath,[new URL('../skill-tools-mcp.mjs',import.meta.url).pathname,file,hash(file)],{stdio:['pipe','pipe','pipe']});t.after(()=>server.kill('SIGKILL'));server.stdout.resume();server.stderr.resume();
 const request=n=>JSON.stringify({jsonrpc:'2.0',id:n,method:'tools/call',params:{name:'invoke',arguments:{kind:'phone',action_name:'call'+n,args:[]}}})+'\n';
 server.stdin.write(request(1));
 const end=Date.now()+2000;while(!fs.existsSync(path.join(cwd,'pids.json'))&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert(fs.existsSync(path.join(cwd,'pids.json')));
 server.stdin.write(request(2));if(mode==='EOF')server.stdin.end();else server.kill('SIGTERM');
 await Promise.race([once(server,'close'),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('server_leaked')),2500);timer.unref();})]);
 assert.equal(fs.readFileSync(path.join(cwd,'starts'),'utf8'),'call1\n');
 for(const pid of JSON.parse(fs.readFileSync(path.join(cwd,'pids.json'))))await assertStopped(pid);
 assert.equal(JSON.parse(fs.readFileSync(path.join(binding.directory,'call1.json'))).state,'unknown');
 assert(!fs.existsSync(path.join(binding.directory,'call2.json')));
});
test('真实Worker进程传冻结身份到stdio MCP，并保持认证deny和精确invoke授权',async t=>{
 const {spawn}=await import('node:child_process');const {once}=await import('node:events');
 const {binding,cwd,options}=fixture(t,`import fs from 'node:fs';const x=JSON.parse(fs.readFileSync(process.env.COMMANDER_ACTIVITY_INPUT_FILE));console.log(JSON.stringify({state:'terminal',result:{exit_code:0},data:{identity:x.identity,key:process.env.COMMANDER_ACTIVITY_KEY}}));`);
 const bin=path.join(cwd,'codex.cjs'),authHome=path.join(cwd,'auth'),work=path.join(cwd,'worker');fs.mkdirSync(authHome,{mode:0o700});fs.mkdirSync(work);
 fs.writeFileSync(path.join(authHome,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'synthetic-test-only'}}),{mode:0o600});
 fs.writeFileSync(bin,`#!${process.execPath}
 const fs=require('fs'),{spawn}=require('child_process'),readline=require('readline');let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',async()=>{
 const argv=process.argv.slice(2),configs=argv.filter((_,i)=>argv[i-1]==='-c');fs.writeFileSync('captured-args.json',JSON.stringify(argv));
 const config=k=>JSON.parse(configs.find(v=>v.startsWith(k+'=')).slice(k.length+1));
 const server=spawn(config('mcp_servers.commander_host_tools.command'),config('mcp_servers.commander_host_tools.args'),{stdio:['pipe','pipe','ignore']});const waiting=new Map();let id=0;
 readline.createInterface({input:server.stdout}).on('line',line=>{const r=JSON.parse(line);waiting.get(r.id)?.(r);});
 const call=(method,params)=>new Promise(resolve=>{waiting.set(++id,resolve);server.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\\n');});
 await call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'1'}});
 const response=await call('tools/call',{name:'invoke',arguments:{kind:'phone',action_name:'worker-one',args:[]}});if(response.error)throw Error(response.error.message);
 fs.writeFileSync(argv[argv.indexOf('-o')+1],JSON.stringify({tool:JSON.parse(response.result.content[0].text)}));
 console.log(JSON.stringify({type:'thread.started',thread_id:'synthetic-thread'}));server.stdin.end();});`,{mode:0o700});
 const request={identity:binding.identity,activity_key:'collect',cwd,work_dir:work,thread_file:path.join(cwd,'thread.json'),context:{},skill_text:'fixture',tools_text:'fixture',codex:{command:bin,command_sha256:hash(bin),args:[],env_keys:[]},codex_auth:{mode:'subscription',home:authHome},host_tools:{config:{...options.config,response_paths:['state','data']},cwd,files:options.files,deadline_ms:Date.now()+10000}};
 const worker=spawn(process.execPath,[new URL('../skill-worker.mjs',import.meta.url).pathname],{cwd,stdio:['pipe','pipe','pipe']});t.after(()=>worker.kill('SIGKILL'));let output='',error='';worker.stdout.on('data',d=>output+=d);worker.stderr.on('data',d=>error+=d);worker.stdin.end(JSON.stringify(request));
 const [code]=await once(worker,'close');assert.equal(code,0,error);const result=JSON.parse(output);assert.deepEqual(result.proposal.tool.output.data.identity,binding.identity);assert.equal(result.proposal.tool.output.data.key,'collect');
 const argv=JSON.parse(fs.readFileSync(path.join(cwd,'captured-args.json')));assert(argv.includes('--ignore-user-config'));assert(argv.includes('mcp_servers.commander_host_tools.tools.invoke.approval_mode="approve"'));
 const permission=argv.filter(x=>x.startsWith('permissions='));assert.equal(permission.length,2);for(const p of [authHome,path.join(process.env.HOME,'.credentials'),path.join(fs.realpathSync(work),'host-tools')])assert(permission.at(-1).includes(JSON.stringify(p)+'="deny"'));
 assert.equal(JSON.parse(fs.readFileSync(path.join(work,'host-tools/worker-one.json'))).state,'terminal');
});
test('stdio完整请求后立即EOF也不能在关闭后启动首个动作',async t=>{
 const {spawn}=await import('node:child_process');const {once}=await import('node:events');
 const {binding,cwd}=fixture(t,`import fs from 'node:fs';fs.writeFileSync('unexpected-start','yes');console.log('{"state":"terminal"}');`);
 const file=path.join(cwd,'binding.json');fs.writeFileSync(file,JSON.stringify(binding));
 const server=spawn(process.execPath,[new URL('../skill-tools-mcp.mjs',import.meta.url).pathname,file,hash(file)],{stdio:['pipe','pipe','pipe']});server.stdout.resume();server.stderr.resume();t.after(()=>server.kill('SIGKILL'));
 server.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'invoke',arguments:{kind:'phone',action_name:'one',args:[]}}})+'\n');
 await once(server,'close');assert(!fs.existsSync(path.join(cwd,'unexpected-start')));
});
