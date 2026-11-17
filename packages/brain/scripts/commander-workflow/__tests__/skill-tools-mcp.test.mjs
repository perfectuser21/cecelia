import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareHostTools,createHostToolCaller,hostToolsArgs} from '../skill-tools-mcp.mjs';
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function fixture(t,source){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'host-tools-test-'));t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
 fs.writeFileSync(path.join(cwd,'tool.mjs'),source??`console.log(JSON.stringify({state:'terminal',result:{exit_code:0},secret:'FAKE_SECRET',stdout:'FAKE_SECRET',stderr:'FAKE_SECRET'}))`);
 const inputFile=path.join(cwd,'activity-input.json'),identity={task_id:'task',run_id:'run',action_id:'action',attempt:1};
 fs.writeFileSync(inputFile,JSON.stringify({identity,activity_key:'collect'}));
 const options={config:{command:process.execPath,command_sha256:hash(process.execPath),entry:'tool.mjs',timeout_ms:2000,response_paths:['state','result.exit_code']},cwd,files:{'tool.mjs':hash(path.join(cwd,'tool.mjs'))},identity,activityKey:'collect',inputFile,directory:path.join(cwd,'host-private'),deadlineMs:Date.now()+30000};
 return {cwd,options,binding:prepareHostTools(options)};
}
test('冻结工具宿主调用且只返回审阅过的JSON字段，不暴露原stdout/stderr',async t=>{
 const {binding}=fixture(t),caller=createHostToolCaller(binding);const a={kind:'phone',action_name:'one',args:['read']};
 const out=await caller.call(a);assert.equal(out.output.state,'terminal');assert.equal(out.output['result.exit_code'],0);assert(!JSON.stringify(out).includes('FAKE_SECRET'));
 const prior=await caller.call(a);assert.deepEqual(prior,out);await assert.rejects(caller.call({...a,args:['different']}),/host_tool_action_conflict/);
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
 const caller=createHostToolCaller({...binding,timeout_ms:250}),a={kind:'phone',action_name:'timeout',args:[]};
 await assert.rejects(caller.call(a),/host_tool_unknown/);for(const pid of JSON.parse(fs.readFileSync(path.join(cwd,'pids.json')))){await new Promise(r=>setTimeout(r,80));assert.throws(()=>process.kill(pid,0));}
 await assert.rejects(caller.call(a),/host_tool_unknown/);
});
test('stdio MCP只注册固定工具参数，不放开Codex认证配置',t=>{
 const {binding}=fixture(t),args=hostToolsArgs('/fixed/binding.json','a'.repeat(64),binding.directory);
 assert(args.some(x=>x.startsWith('mcp_servers.commander_host_tools.command=')));
 assert(!args.some(x=>x.includes('danger-full-access')));assert(args.some(x=>x.includes('filesystem')&&x.includes('deny')));
 assert.throws(()=>prepareHostTools({...fixture(t).options,config:{...binding.config,entry:'../escape'}}),/host_tool_config_invalid/);
});
