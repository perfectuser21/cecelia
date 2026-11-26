import {test,expect,afterEach,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRuntime} from '../../../scripts/commander-workflow/skill-adapter.mjs';
import {frozenNodeCommand} from './fixtures/frozen-node-command.js';
import {createRunLedger} from '../commander-usage-ledger.js';
const roots=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'commander-code-'));roots.push(root);fs.chmodSync(root,0o700);
 fs.writeFileSync(path.join(root,'owned-resource'),'owned');
 fs.writeFileSync(path.join(root,'work.js'),`const fs=require('fs');let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const i=JSON.parse(s);fs.appendFileSync('executions.jsonl',JSON.stringify({input:i,argv:process.argv.slice(2)})+'\\n');if(i.mode==='hang'){setInterval(()=>{},1000);return;}fs.rmSync('owned-resource',{force:true});const r={schema_version:1,run_tag:i.run_tag,line_key:i.line_key,status:'completed',outputs:{released:true},metrics:{count:1},evidence:['owned-resource'],execution_stopped:true,...i.result};console.log(i.mode==='invalid'?'not-json':JSON.stringify(r));process.exitCode=i.mode==='nonzero'?2:0;});`);
 fs.writeFileSync(path.join(root,'check.cjs'),`const fs=require('fs');let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const r=JSON.parse(s),released=!fs.existsSync('owned-resource'),good=r.phase==='start'||released;console.log(JSON.stringify({identity:Object.fromEntries(['task_id','run_id','run_tag','workflow','activity','attempt'].map(k=>[k,r[k]])),nonce:r.context.bad_nonce?'wrong':r.nonce,outcome:'passed',checks:r.checks.map(id=>({id,status:good&&!r.context.check_failed?'passed':'failed',evidence:[{source:'owned-resource',observation:{released}}]})),output:r.phase==='start'?{}:{released:true}}));});`);
 const nodeCommand=frozenNodeCommand(root);
 const checker={...nodeCommand,entry:'check.cjs',start_checks:['owner'],required_checks:['released']};
 const profile={cwd:root,files:Object.fromEntries(['work.js','check.cjs'].map(f=>[f,sha(path.join(root,f))])),skill_runtime:{control_dir:'control',activities:{cleanup:{checker}}}};
 const activity={key:'cleanup',order:1,budget:{max_duration_s:5,heartbeat_s:1},failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:[]}},runtime:{phase:'source',executor_kind:'code',entry:'work.js',argv:['fixed-arg'],interactive:false,protocol:'json-stdio-v1',cleanup_grace_s:1}};
 const run={task_id:randomUUID(),run_id:randomUUID(),input:{run_tag:'tag'},contract:{workflow:'code-fixture',activities:[activity]}};
 const identity={task_id:run.task_id,run_id:run.run_id,action_id:'action',activity_key:'cleanup',definition_sha256:'a'.repeat(64),input_sha256:'b'.repeat(64)};
 const options={identity,cwd:root,deadlineMs:Date.now()+5000};
 return {root,profile,activity,run,identity,options,input:{run_tag:'tag',line_key:'line'}};
}
test('code-only无需Codex、Skill或tools，真实冻结entry执行并独立读回，同动作不重复',async()=>{
 const f=fixture(),runtime=await createRuntime(f);
 const result=await runtime.executeActivity(f.activity,f.input,f.options);
 expect(result.status).toBe('completed');expect(result.outputs).toEqual({released:true});expect(result.execution_stopped).toBe(true);
 expect((await runtime.checkActivity(f.activity,result,{phase:'end',input:f.input})).verdict).toBe('pass');
 const recovered=await (await createRuntime(f)).inspectActivity(f.activity,f.input,f.options);
 expect(recovered.identity).toEqual(f.identity);expect(recovered.execution_stopped).toBe(true);expect(recovered.result).toEqual(result);
 const calls=fs.readFileSync(path.join(f.root,'executions.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 expect(calls).toHaveLength(1);expect(calls[0]).toEqual({input:f.input,argv:['fixed-arg']});
 expect(fs.existsSync(path.join(f.root,'control',f.run.run_id,'thread.json'))).toBe(false);
 const wrong=await runtime.inspectActivity(f.activity,f.input,{...f.options,identity:{...f.identity,input_sha256:'c'.repeat(64)}});
 expect(wrong.state).toBe('unknown');
 fs.unlinkSync(path.join(f.root,'control',f.run.run_id,'actions','action','result.json'));
 expect((await runtime.inspectActivity(f.activity,f.input,f.options)).state).toBe('unknown');
 expect(fs.readFileSync(path.join(f.root,'executions.jsonl'),'utf8').trim().split('\n')).toHaveLength(1);
});
test('Code同名业务轮次保留原值，但checker身份信封仍是真实第一轮',async()=>{
 const f=fixture(),runtime=await createRuntime(f),input={...f.input,execution_attempt:42,checker_feedback:{business:'existing-input'}};
 const result=await runtime.executeActivity(f.activity,input,f.options);
 expect(result.status).toBe('completed');
 expect((await runtime.checkActivity(f.activity,result,{phase:'end',input})).verdict).toBe('pass');
 expect((await runtime.inspectActivity(f.activity,input,f.options)).result).toEqual(result);
 const calls=fs.readFileSync(path.join(f.root,'executions.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 expect(calls).toHaveLength(1);expect(calls[0].input).toEqual(input);
 const directory=path.join(f.root,'control',f.run.run_id,'checks');
 const checks=fs.readdirSync(directory).map(file=>JSON.parse(fs.readFileSync(path.join(directory,file),'utf8')));
 expect(checks).toHaveLength(2);
 for(const check of checks){
  expect(check.request.attempt).toBe(1);expect(check.observed.identity.attempt).toBe(1);
  expect(check.request.context).toMatchObject({execution_attempt:42,checker_feedback:{business:'existing-input'}});
 }
});
test.each([
 ['failed',{status:'failed',failure_class:'fatal'},'failed',true],
 ['needs_review',{status:'needs_review',failure_class:'needs_human'},'needs_review',true],
 ['unknown',{external_effect:'unknown'},'completed',false],
 ['running',{execution_stopped:false},'completed',false],
 ['missing-stop',{execution_stopped:null},'completed',false],
])('Code %s状态与执行安全事实在执行及恢复时不洗白',async(_label,result,status,stopped)=>{
 const f=fixture(),runtime=await createRuntime(f),input={...f.input,result};
 const out=await runtime.executeActivity(f.activity,input,f.options);
 expect(out.status).toBe(status);expect(out.execution_stopped).toBe(stopped);
 if(result.external_effect)expect(out.external_effect).toBe(result.external_effect);
 const recovered=await runtime.inspectActivity(f.activity,input,f.options);expect(recovered.result).toEqual(out);expect(recovered.execution_stopped).toBe(stopped);
});
test.each(['wrong-tag','wrong-line','invalid','nonzero'])('Code %s不能成为成功或错误地证明已停止',async mode=>{
 const f=fixture(),runtime=await createRuntime(f),input={...f.input,mode};
 if(mode==='wrong-tag')input.result={run_tag:'other'};
 if(mode==='wrong-line')input.result={line_key:'other'};
 const options={...f.options,deadlineMs:Date.now()+5000};
 const out=await runtime.executeActivity(f.activity,input,options);
 expect(out.status).toBe('needs_review');
 if(mode!=='nonzero')expect(out.execution_stopped).toBe(false);
 const recovered=await runtime.inspectActivity(f.activity,input,options);expect(recovered.result).toEqual(out);
});
test('Code已启动后卡住：截止收尾保持未知，恢复不重复执行',async()=>{
 const f=fixture(),runtime=await createRuntime(f),input={...f.input,mode:'hang'};
 // 预算包含独立start checker和监督进程启动；400ms会在CI中先耗尽，根本未测到hang。
 const options={...f.options,deadlineMs:Date.now()+5000};
 const out=await runtime.executeActivity(f.activity,input,options);
 expect(out.status).toBe('needs_review');expect(out.execution_stopped).toBe(false);
 expect(fs.existsSync(path.join(f.root,'owned-resource'))).toBe(true);
 const calls=()=>fs.readFileSync(path.join(f.root,'executions.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 expect(calls()).toHaveLength(1);expect(calls()[0].input.mode).toBe('hang');
 const recovered=await runtime.inspectActivity(f.activity,input,options);
 expect(recovered.result).toEqual(out);expect(recovered.execution_stopped).toBe(false);
 expect(calls()).toHaveLength(1);
},15000);
test('Code启动前预算已耗尽：明确拒绝且没有执行副作用',async()=>{
 const f=fixture(),runtime=await createRuntime(f);
 await expect(runtime.executeActivity(f.activity,{...f.input,mode:'hang'},{...f.options,deadlineMs:Date.now()-1}))
  .rejects.toMatchObject({message:'activity_deadline_elapsed',executionStopped:true});
 expect(fs.existsSync(path.join(f.root,'executions.jsonl'))).toBe(false);
 expect(fs.existsSync(path.join(f.root,'owned-resource'))).toBe(true);
});
test.each(['check_failed','bad_nonce'])('Code %s独立checker不能被exit0覆盖',async mode=>{
 const f=fixture(),runtime=await createRuntime(f);
 const out=await runtime.executeActivity(f.activity,f.input,f.options);
 await expect(runtime.checkActivity(f.activity,out,{phase:'end',input:{...f.input,[mode]:true}})).rejects.toThrow();
});
test.each(['work.js','check.cjs'])('Code执行前%s来源漂移没有执行权',async file=>{
 const f=fixture(),runtime=await createRuntime(f);fs.appendFileSync(path.join(f.root,file),'\n// drift');
 await expect(runtime.executeActivity(f.activity,f.input,f.options)).rejects.toThrow('commander_source_drift');
 expect(fs.existsSync(path.join(f.root,'executions.jsonl'))).toBe(false);
});

// 仅DBOS调度为确定性夹具；adapter、监督子进程和独立checker均真实执行。
const sdk=vi.hoisted(()=>({initialized:false,inputs:new Map()}));
vi.mock('@dbos-inc/dbos-sdk',()=>({DBOS:{isInitialized:()=>sdk.initialized,registerStep:fn=>fn,registerWorkflow:fn=>fn,
 startWorkflow:(fn,{workflowID})=>async value=>{sdk.inputs.set(workflowID,value);return {getWorkflowInputs:async()=>[value],getResult:()=>fn(value)};},
}}));
import {configureCommanderWorkflow,startCommanderWorkflow} from '../../durable/commander-workflow.js';
function addAgent(f){
 const write=(name,text)=>{fs.writeFileSync(path.join(f.root,name),text);f.profile.files[name]=sha(path.join(f.root,name));};
 write('skill.txt','生成一个经过独立核验的源活动结果');write('tools.txt','只允许本地隔离夹具');
 write('codex.cjs',`const fs=require('fs');process.stdin.resume();process.stdin.on('end',()=>{fs.appendFileSync('model-calls','1\\n');fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],'{}');console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-thread'}));});`);
 write('source-check.cjs',fs.readFileSync(path.join(f.root,'check.cjs'),'utf8').replace("good=r.phase==='start'||released","good=true").replace("output:r.phase==='start'?{}:{released:true}","output:r.phase==='start'?{}:{source_verified:true}"));
 const config=f.profile.skill_runtime;config.tools='tools.txt';config.codex={command:config.activities.cleanup.checker.command,command_sha256:config.activities.cleanup.checker.command_sha256,args:[path.join(f.root,'codex.cjs')]};
 config.activities.source={skill:'skill.txt',checker:{...config.activities.cleanup.checker,entry:'source-check.cjs'}};
 return {...f.activity,key:'source',order:1,runtime:{...f.activity.runtime,executor_kind:'agent'}};
}
async function workflow(f,decide,{businessMs=10000,cleanupMs=15000}={}){
 sdk.initialized=false;sdk.inputs.clear();process.env.DBOS_DURABLE_ENABLED='true';
 const runtime=await createRuntime(f),records=new Map();
 configureCommanderWorkflow({...runtime,cwd:f.root,revision:'a'.repeat(64),verifySource:async()=>{},decide:decide??(async req=>{
  const {protocol,run_id,definition_sha256,sequence,state_sha256}=req;return {protocol,run_id,definition_sha256,sequence,state_sha256,...req.allowed_actions[0],reason:'fixture'};
 }),actionStore:{reserve:async(identity,{deadline_ms})=>{const record={identity,state:'reserved',deadline_ms};records.set(identity.action_id,record);return {created:true,record};},settle:async(id,result)=>{records.get(id.action_id).result=result;return result;}}});
 sdk.initialized=true;
 const now=Date.now();
 try{return await (await startCommanderWorkflow({...f.run,schema_version:1,runtime_revision:'a'.repeat(64),deadline_ms:now+businessMs,cleanup_deadline_ms:now+cleanupMs,commander_timeout_ms:500})).handle.getResult();}
 finally{sdk.initialized=false;}
}
test('混合agent source及code finalize只为Agent调用模型，独立验收后资源归位',async()=>{
 const f=fixture(),source=addAgent(f);
 // 此用例验证跨执行器交接，给真实子进程及多轮独立 Checker 留出慢速宿主启动时间。
 source.budget={...source.budget,max_duration_s:20};
 f.activity={...f.activity,order:2,runtime:{...f.activity.runtime,phase:'finalize'}};f.run.contract.activities=[source,f.activity];
 const out=await workflow(f,undefined,{businessMs:30000,cleanupMs:35000});expect(out.status,JSON.stringify({run_reason:out.reason,cleanup:out.cleanup_status,
    attempts:out.attempt_history?.map(x=>({activity:x.activity_key,status:x.status,reason:x.reason_code,rows:x.activities?.map(y=>({
      key:y.key,validator:y.validator_verdict,results:y.attempts?.map(z=>({status:z.status,reason:z.reason_code,transport:z.transport}))
    }))}))})).toBe('completed');expect(out.cleanup_status).toBe('completed');
 expect(fs.readFileSync(path.join(f.root,'model-calls'),'utf8').trim().split('\n')).toHaveLength(1);
 expect(fs.readFileSync(path.join(f.root,'executions.jsonl'),'utf8').trim().split('\n')).toHaveLength(1);
 expect(fs.existsSync(path.join(f.root,'owned-resource'))).toBe(false);
},40000);
test('Commander模型不可用但无在途，Code收尾真释放资源，业务失败保持',async()=>{
 const f=fixture(),source=addAgent(f);f.activity={...f.activity,order:2,runtime:{...f.activity.runtime,phase:'finalize'}};f.run.contract.activities=[source,f.activity];
 const out=await workflow(f,async()=>{throw Error('quota_exhausted');});
 expect(out.status).toBe('needs_review');expect(out.business_pass).toBe(false);expect(out.cleanup_status).toBe('completed');
 expect(fs.existsSync(path.join(f.root,'model-calls'))).toBe(false);expect(fs.existsSync(path.join(f.root,'owned-resource'))).toBe(false);
});
test('源活动外部执行未知则禁止Code finalizer，资源及执行次数证明未清理',async()=>{
 const f=fixture();
 fs.writeFileSync(path.join(f.root,'source.js'),`let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const i=JSON.parse(s);console.log(JSON.stringify({schema_version:1,run_tag:i.run_tag,status:'completed',outputs:{},metrics:{},evidence:[],execution_stopped:false,external_effect:'unknown'}));});`);
 f.profile.files['source.js']=sha(path.join(f.root,'source.js'));f.profile.skill_runtime.activities.source=f.profile.skill_runtime.activities.cleanup;
 const source={...f.activity,key:'source',runtime:{...f.activity.runtime,entry:'source.js'}};
 f.activity={...f.activity,order:2,runtime:{...f.activity.runtime,phase:'finalize'}};f.run.contract.activities=[source,f.activity];
 const out=await workflow(f);expect(out.business_pass).toBe(false);expect(out.cleanup_status).toBe('blocked');
 expect(fs.existsSync(path.join(f.root,'owned-resource'))).toBe(true);expect(fs.existsSync(path.join(f.root,'executions.jsonl'))).toBe(false);
});

test('源活动超时后凭同动作原生终态证据自动归位，业务失败并且源动作只执行一次',async()=>{
 const f=fixture();
 f.ledger=createRunLedger({directory:path.join(fs.realpathSync(f.root),'ledger'),identity:{task_id:f.run.task_id,run_id:f.run.run_id}});
 const checkerFile=path.join(f.root,'check.cjs');
 const checkerSource=fs.readFileSync(checkerFile,'utf8');
 fs.writeFileSync(checkerFile,checkerSource.replace("good=r.phase==='start'||released",
  "good=r.phase==='start'?(r.activity!=='cleanup'||r.verified_execution_stops?.some(stop=>stop.execution_stopped&&stop.action_id===fs.readFileSync('source-dispatches','utf8').trim())):released"));
 f.profile.files['check.cjs']=sha(checkerFile);
 const files={
  'slow-source.js':`const fs=require('node:fs'),{spawn}=require('node:child_process');
   let stdin='';process.stdin.on('data',part=>stdin+=part);
   process.stdin.on('end',()=>{
    const {action_id}=JSON.parse(stdin);fs.appendFileSync('source-dispatches',action_id+'\\n');
    const native=spawn(process.execPath,['-e',"setTimeout(()=>require('node:fs').writeFileSync('native-stopped',process.argv[1]),5300)",action_id],{detached:true,stdio:'ignore'});
    native.unref();setInterval(()=>{},1000);
   });`,
  'stop-check.cjs':`const fs=require('node:fs');let stdin='';process.stdin.on('data',part=>stdin+=part);
   process.stdin.on('end',()=>{
    const {identity,nonce}=JSON.parse(stdin);
    const poll=setInterval(()=>{
     if(!fs.existsSync('native-stopped')||fs.readFileSync('native-stopped','utf8')!==identity.action_id)return;
     clearInterval(poll);console.log(JSON.stringify({identity,nonce,execution_stopped:true,evidence:{source:'native-stopped'}}));
    },25);
   });`,
 };
 for(const [name,source] of Object.entries(files)){
  const file=path.join(f.root,name);fs.writeFileSync(file,source);f.profile.files[name]=sha(file);
 }
 const cleanup=f.profile.skill_runtime.activities.cleanup;
 f.profile.skill_runtime.activities.source={checker:cleanup.checker,stop_checker:{command:cleanup.checker.command,
  command_sha256:cleanup.checker.command_sha256,entry:'stop-check.cjs',timeout_ms:4500}};
 const source={...f.activity,key:'source',runtime:{...f.activity.runtime,entry:'slow-source.js'}};
 f.activity={...f.activity,order:2,runtime:{...f.activity.runtime,phase:'finalize'}};f.run.contract.activities=[source,f.activity];
 const out=await workflow(f,undefined,{businessMs:5200,cleanupMs:20000});
 expect(out).toMatchObject({status:'needs_review',business_pass:false,cleanup_status:'completed'});
 expect(out.attempt_history.find(attempt=>attempt.activity_key==='source')?.execution_unknown).toBe(true);
 const dispatches=fs.readFileSync(path.join(f.root,'source-dispatches'),'utf8').trim().split('\n');
 expect(dispatches).toHaveLength(1);
 const proof=JSON.parse(fs.readFileSync(out.cleanup_stop_evidence,'utf8'));
 expect(proof.observed).toMatchObject({identity:{action_id:dispatches[0]},execution_stopped:true,evidence:{source:'native-stopped'}});
 expect(proof.request.nonce).toBe(proof.observed.nonce);
 const recorded=f.ledger.snapshot();
 expect(recorded.attempts.find(entry=>entry.action_id===dispatches[0]).status).toBe('prepared');
 expect(recorded.observations).toEqual(expect.arrayContaining([expect.objectContaining({
  kind:'execution_stop_verified',activity_key:'source',action_id:dispatches[0],attempt:1,status:'completed',evidence_ref:out.cleanup_stop_evidence,
 })]));
 const checks=fs.readdirSync(path.join(f.root,'control',f.run.run_id,'checks')).map(name=>
  JSON.parse(fs.readFileSync(path.join(f.root,'control',f.run.run_id,'checks',name),'utf8')).request);
 expect(checks.find(check=>check.activity==='cleanup'&&check.phase==='start').verified_execution_stops).toEqual([{
  activity_key:'source',action_id:dispatches[0],attempt:1,execution_stopped:true,
 }]);
 expect(checks.find(check=>check.activity==='source'&&check.phase==='start').verified_execution_stops).toBeUndefined();
 expect(fs.readFileSync(path.join(f.root,'executions.jsonl'),'utf8').trim().split('\n')).toHaveLength(1);
 expect(fs.existsSync(path.join(f.root,'owned-resource'))).toBe(false);
},25000);

test('冻结测试启动器源码漂移时真实runtime拒绝执行',async()=>{
 const f=fixture(),runtime=await createRuntime(f);
 fs.appendFileSync(f.profile.skill_runtime.activities.cleanup.checker.command,'\n# drift\n');
 await expect(runtime.executeActivity(f.activity,f.input,f.options)).rejects.toThrow('skill_profile_unfrozen');
 expect(fs.existsSync(path.join(f.root,'executions.jsonl'))).toBe(false);
 expect(fs.existsSync(path.join(f.root,'owned-resource'))).toBe(true);
});

test('冻结测试启动器安全转发含空格与单引号的Node路径',async()=>{
 const f=fixture(),node=path.join(f.root,"node ' quoted");
 fs.symlinkSync(process.execPath,node);
 Object.assign(f.profile.skill_runtime.activities.cleanup.checker,frozenNodeCommand(f.root,node));
 const runtime=await createRuntime(f),result=await runtime.executeActivity(f.activity,f.input,f.options);
 expect(result.status).toBe('completed');
 expect((await runtime.checkActivity(f.activity,result,{phase:'end',input:f.input})).verdict).toBe('pass');
 const calls=fs.readFileSync(path.join(f.root,'executions.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 expect(calls).toEqual([{input:f.input,argv:['fixed-arg']}]);
});
