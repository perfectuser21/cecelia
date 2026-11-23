import {test,expect,vi} from 'vitest';
const dbos=vi.hoisted(()=>({initialized:false}));
vi.mock('@dbos-inc/dbos-sdk',()=>({DBOS:{isInitialized:()=>dbos.initialized,registerStep:fn=>fn,registerWorkflow:fn=>fn,
 startWorkflow:fn=>async value=>({getWorkflowInputs:async()=>[value],getResult:()=>fn(value)})}}));
import {configureCommanderWorkflow,startCommanderWorkflow} from '../../durable/commander-workflow.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRuntime} from '../../../scripts/commander-workflow/skill-adapter.mjs';
import {archiveActivityHandoff} from '../../../scripts/commander-workflow/activity-handoff.mjs';
import {createHostToolCaller,prepareHostTools} from '../../../scripts/commander-workflow/skill-tools-mcp.mjs';
import {checkerEvidenceReceipts,prepareCheckerEvidence,readCheckerArchive,readCheckerEvidence} from '../../../scripts/commander-workflow/checker-evidence.mjs';
import {digest} from '../commander-decision.js';
import {createRunLedger} from '../commander-usage-ledger.js';
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function fixture({requirement='number equals 42',fact={number:42},mode='normal',emptyAllowed=false}={}){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'general-checker-'));fs.chmodSync(cwd,0o700);
 const auth=path.join(cwd,'auth');fs.mkdirSync(auth,{mode:0o700});fs.writeFileSync(path.join(auth,'auth.json'),JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'fixture-not-a-real-key'}),{mode:0o600});
 fs.mkdirSync(path.join(cwd,'evidence'));if(fact!==null)fs.writeFileSync(path.join(cwd,'evidence','fact.json'),JSON.stringify(fact));
 const executable=path.join(cwd,'codex-fixture');
 // A deterministic CLI test double exercises the actual worker, MCP server and adapter.
 // It is not evidence that a real model can interpret natural-language contracts.
 fs.writeFileSync(executable,`#!${process.execPath}
const fs=require('fs'),cp=require('child_process'),path=require('path');
let prompt='';process.stdin.on('data',b=>prompt+=b);process.stdin.on('end',async()=>{
 const input=JSON.parse(fs.readFileSync(process.env.COMMANDER_ACTIVITY_INPUT_FILE));const r=input.checker_request;
 const refScenario=['final-ref-recheck','final-ref-always-wrong','final-timeout-recheck'].includes('${mode}');
 const mediated='${mode}'.startsWith('mediated-');
 const repairScenario='${mode}'.startsWith('readonly-repair')||mediated;
 if(!r&&['delivery','delivery-existing-evidence','delivery-timeout'].includes('${mode}')){
  const field='${mode}'==='delivery-existing-evidence'?'evidence':'handoff';
  fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({outputs:{number:42},[field]:{run:{source:'evidence/fact.json'}}}));
  console.log(JSON.stringify({type:'thread.started',thread_id:'execution-thread'}));return;
 }
 if(!r&&repairScenario){
  if('${mode}'==='readonly-repair-missing')fs.rmSync('evidence/fact.json');
  if(mediated&&('${mode}'!=='mediated-empty'||input.identity.attempt>1)){
   const arg=process.argv.find(a=>a.startsWith('mcp_servers.commander_host_tools.args='));
   const [server,bindingFile]=JSON.parse(arg.slice(arg.indexOf('=')+1));
   const {createHostToolCaller}=await import(require('node:url').pathToFileURL(server));
   const binding=JSON.parse(fs.readFileSync(bindingFile));
   try{await createHostToolCaller(binding).call({kind:'fixture',action_name:'attempt-'+input.identity.attempt,args:[input.identity.attempt===1?'initial':'apply']});}
   catch(error){if(error.message!=='host_tool_unknown')throw error;}
   if('${mode}'==='mediated-tampered')fs.appendFileSync(path.join(binding.directory,'attempt-1.json.stdout'),' ');
  }
  fs.appendFileSync('executor-calls.jsonl',JSON.stringify({argv:process.argv,prompt})+'\\n');
  fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({outputs:{number:input.identity.attempt>1&&('${mode}'==='readonly-repair'||mediated)?42:0}}));
  console.log(JSON.stringify({type:'thread.started',thread_id:'execution-thread'}));return;
 }
 if(!r){if(refScenario)fs.appendFileSync('execution-count.txt','1');if('${mode}'!=='runner'&&!refScenario)fs.writeFileSync('evidence/fact.json',JSON.stringify({number:0}));if('${mode}'==='unknown-after-exec')fs.rmSync('evidence/fact.json');fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({claimed:'passed',outputs:{number:refScenario?42:0}}));console.log(JSON.stringify({type:'thread.started',thread_id:'execution-thread'}));return;}
 if('${mode}'==='hang'){setInterval(()=>{},1000);return;}
 fs.appendFileSync('checker-calls.jsonl',JSON.stringify({argv:process.argv,prompt,request:r})+'\\n');
 if('${mode}'==='delivery-timeout'&&r.phase==='end'){setInterval(()=>{},1000);return;}
 const arg=process.argv.find(a=>a.startsWith('mcp_servers.commander_checker_evidence.args='));
 const serverArgs=JSON.parse(arg.slice(arg.indexOf('=')+1));
 const archived=Boolean(r.proposal?.delivery_evidence);
 const tool=archived?{name:'read_archive',arguments:{}}:{name:'read_file',arguments:{path:'evidence/fact.json'}};
 const rpc=[{jsonrpc:'2.0',id:1,method:'initialize'},{jsonrpc:'2.0',id:2,method:'tools/call',params:tool}];
 const raw=cp.spawnSync(process.execPath,serverArgs,{input:rpc.map(JSON.stringify).join('\\n')+'\\n',encoding:'utf8'});
 if(raw.status!==0)throw Error('actual_evidence_server_failed:'+raw.stderr);
 const response=JSON.parse(raw.stdout.trim().split('\\n').at(-1));if(response.error)throw Error(JSON.stringify(response.error));
 const observed=JSON.parse(response.result.content[0].text),fact=observed.status==='available'?JSON.parse(observed.text):null;
 const checks=r.criteria.map(c=>{const wanted=c.requirement;let matches=typeof wanted!=='string'?true:wanted.startsWith('number equals ')?fact?.number===Number(wanted.slice(14)):fact?.color===wanted.slice(9);
 if(repairScenario&&r.phase==='end'&&c.id==='end_criterion')matches=matches&&r.proposal?.outputs?.number===fact?.number;
 if(r.proposal?.schema_version===1&&typeof wanted==='string'&&wanted.startsWith('number equals '))matches=matches&&r.proposal.outputs.number===fact?.number;
 return {id:c.id,status:fact===null?'unknown':matches?'passed':'failed',reason:fact===null?'Evidence unavailable':matches?'Observed requirement':'Observed contradiction',expected:wanted,actual:fact,evidence:[{source:observed.evidence_ref,observation:{value:fact}}]};});
 const outcome=checks.some(c=>c.status==='unknown')?'unknown':checks.some(c=>c.status==='failed')?'failed':'passed';
 const result={identity:Object.fromEntries(['task_id','run_id','run_tag','workflow','activity','attempt'].map(k=>[k,r[k]])),nonce:r.nonce,outcome,checks,output:r.proposal?.outputs??{},retryable:false,external_effect:'none'};
 if('${mode}'==='runner'&&r.phase==='end')result.output={number:42,description:'Verified in '+r.nonce};
 if('${mode}'==='empty')result.outcome='empty';
 if(refScenario&&r.phase==='end'){
  const endings=fs.readFileSync('checker-calls.jsonl','utf8').trim().split('\\n').map(JSON.parse).filter(call=>call.request.phase==='end');
  if('${mode}'==='final-timeout-recheck'&&endings.length===1){setInterval(()=>{},1000);return;}
  if('${mode}'==='final-ref-always-wrong'||('${mode}'==='final-ref-recheck'&&endings.length===1))result.checks[0].evidence[0].source='/invented';
 }
 if('${mode}'==='wrong-nonce')result.nonce='foreign';if('${mode}'==='invented-evidence')result.checks[0].evidence[0].source='/invented';
 result.output_json=JSON.stringify(result.output);delete result.output;
 fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify(result));console.log(JSON.stringify({type:'thread.started',thread_id:'checker-'+r.nonce}));
});`,{mode:0o700});
 fs.writeFileSync(path.join(cwd,'skill.txt'),'Execute only the current contract.');fs.writeFileSync(path.join(cwd,'tools.txt'),'Execution tools are not Checker tools.');
 const document={preconditions:[requirement],postconditions:[requirement],failure:{empty_ok:emptyAllowed?['An independently observed empty result is permitted']:[],unknown:'Evidence not available'}};
 const activity={key:'arbitrary_'+randomUUID().slice(0,8),acceptance:{source:{repo:'fixture',path:'contract.yaml',activity_ref:'fixture',contract_digest:digest(document)},document,
 criteria:[...['start','end'].map(phase=>({id:phase+'_criterion',phase,requirement,source_pointer:phase==='start'?'/preconditions/0':'/postconditions/0'})),{id:'failure',phase:'end',source_pointer:'/failure',requirement:document.failure}]},budget:{max_duration_s:8,heartbeat_s:1},runtime:{phase:'source',protocol:'json-stdio-v1',entry:'unused',executor_kind:'agent'}};
 const checker={mode:'agent',timeout_ms:5000,evidence:{roots:['evidence']}};
 const profile={cwd,files:Object.fromEntries(['skill.txt','tools.txt'].map(f=>[f,hash(path.join(cwd,f))])),codex_auth:{mode:'api-only',home:auth},skill_runtime:{control_dir:'control',tools:'tools.txt',codex:{command:executable,command_sha256:hash(executable)},activities:{[activity.key]:{skill:'skill.txt',checker,allow_empty:emptyAllowed}}}};
 const run={task_id:randomUUID(),run_id:randomUUID(),input:{run_tag:'run-fixture'},deadline_ms:Date.now()+15000,contract:{workflow:'unrelated_'+randomUUID(),activities:[activity]}};
 return {cwd,run,profile,activity,async check(){const rt=await createRuntime({profile,run});return rt.checkActivity(activity,{outputs:{}},{phase:'end',input:{run_tag:run.input.run_tag}});},close(){fs.rmSync(cwd,{recursive:true,force:true});}};
}
test('actual adapter launches a fresh Checker and reads evidence through the actual MCP server',async()=>{
 const f=fixture();try{expect((await f.check()).verdict).toBe('pass');await f.check();
 const calls=fs.readFileSync(path.join(f.cwd,'checker-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 expect(calls).toHaveLength(2);expect(calls[0].request.nonce).not.toBe(calls[1].request.nonce);
 for(const c of calls){expect(c.argv).not.toContain('resume');expect(c.argv).toContain('--output-schema');expect(c.argv.join(' ')).toContain(':read-only');expect(c.argv).toContain('shell_tool');expect(c.argv).toContain('unified_exec');expect(c.prompt).toContain('number equals 42');expect(c.request.activity_contract).toEqual(f.activity);expect(c.request.evidence_access.roots).toEqual(['evidence']);}
 }finally{f.close();}
},20000);
test('same Checker supports unrelated contracts and changed clauses change the verdict',async()=>{
 for(const [requirement,fact,verdict] of [['color is green',{color:'green'},'pass'],['number equals 7',{number:42},'fail']]){
 const f=fixture({requirement,fact});try{expect((await f.check()).verdict).toBe(verdict);}finally{f.close();}}
},20000);
test('missing evidence yields unknown, never an executor claimed pass',async()=>{const f=fixture({fact:null});try{expect((await f.check()).verdict).toBe('unknown');}finally{f.close();}},10000);
test('missing complete clauses is rejected before launching any model',async()=>{const f=fixture();try{f.activity.acceptance={description:'Check this Activity',criteria:[]};await expect(f.check()).rejects.toThrow('checker_contract_incomplete');expect(fs.existsSync(path.join(f.cwd,'checker-calls.jsonl'))).toBe(false);}finally{f.close();}});
test.each(['wrong-nonce','invented-evidence'])('unbound %s cannot be a verified Checker result',async mode=>{const f=fixture({mode});try{await expect(f.check()).rejects.toThrow(/checker_|skill_readback/);}finally{f.close();}},10000);
test('contract-declared and independently evidenced empty remains a legitimate empty result',async()=>{
 const f=fixture({mode:'empty',emptyAllowed:true});try{expect((await f.check()).verdict).toBe('pass');
 const records=fs.readdirSync(path.join(f.cwd,'control',f.run.run_id,'checks')).map(p=>JSON.parse(fs.readFileSync(path.join(f.cwd,'control',f.run.run_id,'checks',p))));
 expect(records[0].verified.outcome).toBe('empty');}finally{f.close();}
 const bad=fixture({mode:'empty'});try{await expect(bad.check()).rejects.toThrow('checker_result_invalid');}finally{bad.close();}
},10000);
test('契约声明但宿主缺少的工具在 Checker 和执行 Agent 启动前报告',async()=>{
 const f=fixture();try{
  const document=f.activity.acceptance.document;
  document.required_host_tools=['media-inspect','media-frames'];
  f.activity.acceptance.source.contract_digest=digest(document);
  const runtime=await createRuntime({profile:f.profile,run:f.run});
  const input={run_tag:f.run.input.run_tag};
  const identity={task_id:f.run.task_id,run_id:f.run.run_id,activity_key:f.activity.key,action_id:'missing-tools'};
  await expect(runtime.checkActivity(f.activity,null,{phase:'start',input})).rejects.toThrow('skill_host_tool_missing:media-inspect');
  await expect(runtime.executeActivity(f.activity,input,{identity,cwd:f.cwd,deadlineMs:f.run.deadline_ms})).rejects.toThrow('skill_host_tool_missing:media-inspect');
  expect(fs.existsSync(path.join(f.cwd,'checker-calls.jsonl'))).toBe(false);
 }finally{f.close();}
},10000);
test('unknown preconditions block executor dispatch and Checker calls use the existing ledger',async()=>{
 const f=fixture({fact:null});try{
 const ledger=createRunLedger({directory:path.join(fs.realpathSync(f.cwd),'ledger'),identity:{task_id:f.run.task_id,run_id:f.run.run_id}});
 const runtime=await createRuntime({profile:f.profile,run:f.run,ledger});
 await expect(runtime.executeActivity(f.activity,{run_tag:f.run.input.run_tag},{identity:{task_id:f.run.task_id,run_id:f.run.run_id,activity_key:f.activity.key,action_id:'must-not-execute'},cwd:f.cwd,deadlineMs:Date.now()+5000})).rejects.toThrow('checker_start_unknown');
 const snapshot=ledger.snapshot();expect(snapshot.calls).toHaveLength(1);expect(snapshot.calls[0].role).toBe('checker');expect(snapshot.calls[0].status).toBe('completed');
 expect(fs.existsSync(path.join(f.cwd,'control',f.run.run_id,'actions','must-not-execute'))).toBe(false);
 expect(fs.existsSync(path.join(f.cwd,'evidence','fact.json'))).toBe(false);
 }finally{f.close();}
},10000);
test('actual execution followed by failed Checker preserves feedback without model-granted replay',async()=>{
 const f=fixture();try{const runtime=await createRuntime({profile:f.profile,run:f.run});
 const result=await runtime.executeActivity(f.activity,{run_tag:f.run.input.run_tag},{identity:{task_id:f.run.task_id,run_id:f.run.run_id,activity_key:f.activity.key,action_id:'actual-execution'},cwd:f.cwd,deadlineMs:Date.now()+10000});
 expect(result.status).toBe('needs_review');expect(result.execution_stopped).toBe(true);expect(result.checker_feedback.retryable).toBe(false);expect(result.checker_feedback.thread_id).toBe('execution-thread');
 expect(result.checker_feedback.retry_reason).toBe('trusted_execution_effects_unavailable');
 expect(result.checker_feedback.failed_checks[0]).toMatchObject({id:'end_criterion',status:'failed',expected:'number equals 42',actual:{number:0}});
 expect(result.checker_feedback.previous_proposal.claimed).toBe('passed');expect(result.checker_feedback.evidence_ref).toBeTruthy();
 expect(result.checker_result.checks[0].evidence[0].source).toBeTruthy();
 }finally{f.close();}
},15000);
test('a frozen read-only Activity can resume the original Agent with actual Checker feedback',async()=>{
 const f=fixture({mode:'readonly-repair'});try{
 f.activity.runtime.checker_repair={max_attempts:3,retry_safe:true,effect_scope:'read_only'};
 const rt=await createRuntime({profile:f.profile,run:f.run});
 const input={run_tag:f.run.input.run_tag};
 const options=(attempt)=>({identity:{task_id:f.run.task_id,run_id:f.run.run_id,
  activity_key:f.activity.key,action_id:'readonly-repair-'+attempt,attempt},
  cwd:f.cwd,deadlineMs:f.run.deadline_ms});
 const first=await rt.executeActivity(f.activity,input,options(1));
 expect(first.checker_feedback).toMatchObject({retryable:true,external_effect:'none',thread_id:'execution-thread',
  failed_checks:[{id:'end_criterion',reason:'Observed contradiction'}]});
 const second=await rt.executeActivity(f.activity,{...input,checker_feedback:first.checker_feedback},options(2));
 expect(second.status).toBe('completed');expect(second.outputs.number).toBe(42);
 const calls=fs.readFileSync(path.join(f.cwd,'executor-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 expect(calls).toHaveLength(2);
 for(const call of calls){
  expect(call.argv.join(' ')).toContain(':read-only');
  expect(call.argv).toContain('shell_tool');
  expect(call.argv).not.toContain('--ephemeral');
 }
 expect(calls[1].argv).toContain('resume');expect(calls[1].argv).toContain('execution-thread');
 expect(calls[1].prompt).toContain('Observed contradiction');
 }finally{f.close();}
},20000);

test.each([
 ['mediated-empty',true],
 ['mediated-rejected',true],
 ['mediated-effect',false],
 ['mediated-unknown',false],
 ['mediated-tampered',false],
])('write-capable Agent resumes only with a complete no-effect broker witness: %s',async(mode,retryable)=>{
 const f=fixture({mode});
 try{
  const entry=path.join(f.cwd,'host.cjs');
  fs.writeFileSync(entry,`const fs=require('node:fs'),command=process.argv[4];
 if(command==='initial'&&'${mode}'==='mediated-unknown'){fs.appendFileSync('host-effects.txt','1');process.stdout.write('invalid');return;}
 if(command==='initial'&&['mediated-rejected','mediated-tampered'].includes('${mode}')){
  process.stdout.write(JSON.stringify({state:'terminal',result:{exit_code:2,data:{phase:'pre_dispatch',dispatched:false,external_effect:'none'}}}));process.exitCode=2;
 }else{fs.appendFileSync('host-effects.txt','1');process.stdout.write(JSON.stringify({state:'terminal',result:{exit_code:0}}));}`);
  f.profile.files['host.cjs']=hash(entry);
  f.profile.skill_runtime.host_tools={command:process.execPath,command_sha256:hash(process.execPath),entry:'host.cjs',
   timeout_ms:3000,kinds:['fixture'],response_paths:['state','result.exit_code','result.data']};
  f.activity.runtime.checker_repair={max_attempts:3,retry_safe:true,effect_scope:'host_tools'};
  const rt=await createRuntime({profile:f.profile,run:f.run}),input={run_tag:f.run.input.run_tag};
  const options=attempt=>({identity:{task_id:f.run.task_id,run_id:f.run.run_id,activity_key:f.activity.key,
    action_id:'mediated-'+attempt,attempt},cwd:f.cwd,deadlineMs:f.run.deadline_ms});
  const first=await rt.executeActivity(f.activity,input,options(1));
  expect(first.checker_feedback?.retryable).toBe(retryable);
  if(retryable){
   expect(first.checker_feedback.external_effect).toBe('none');
   const second=await rt.executeActivity(f.activity,{...input,checker_feedback:first.checker_feedback},options(2));
   expect(second.status).toBe('completed');
  }
  const calls=fs.readFileSync(path.join(f.cwd,'executor-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  expect(calls).toHaveLength(retryable?2:1);
  const effects=path.join(f.cwd,'host-effects.txt');
  if(mode==='mediated-tampered')expect(fs.existsSync(effects)).toBe(false);
  else expect(fs.readFileSync(effects,'utf8')).toBe('1');
  expect(calls[0].argv).toContain('shell_tool');
  expect(calls[0].argv.indexOf('--ignore-rules')).toBeGreaterThan(calls[0].argv.indexOf('exec'));
  expect(calls[0].argv.join(' ')).toContain('"network"={"enabled"=false}');
  if(retryable)expect(calls[1].argv).toContain('execution-thread');
 }finally{f.close();}
},20000);

test.each([['final-ref-recheck','completed'],['final-ref-always-wrong','needs_review'],['final-timeout-recheck','completed']])('rechecks original proposal without re-executing the Activity: %s',async(mode,status)=>{
 const f=fixture({mode});try{
  const runtime=await createRuntime({profile:f.profile,run:f.run});
  const deadline=Date.now()+10000;
  const result=await runtime.executeActivity(f.activity,{run_tag:f.run.input.run_tag},{
   identity:{task_id:f.run.task_id,run_id:f.run.run_id,activity_key:f.activity.key,action_id:'original'},
   cwd:f.cwd,deadlineMs:deadline});
  const calls=fs.readFileSync(path.join(f.cwd,'checker-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  expect(result.status).toBe(status);
  expect(calls.map(c=>c.request.phase)).toEqual(['start','end','end']);
  expect(calls[1].request.proposal).toEqual({claimed:'passed',outputs:{number:42}});
  expect(calls[2].request.proposal).toEqual(calls[1].request.proposal);
  expect(calls[2].request.nonce).not.toBe(calls[1].request.nonce);
  expect(fs.readFileSync(path.join(f.cwd,'execution-count.txt'),'utf8')).toBe('1');
  if(status==='completed')expect(result.outputs.number).toBe(42);
 }finally{f.close();}
},15000);

test('Checker supervisor uses the existing Activity deadline, not a fresh run-sized allowance',async()=>{
 const f=fixture();try{const runtime=await createRuntime({profile:f.profile,run:f.run}),start=Date.now();
 await runtime.checkActivity(f.activity,{outputs:{}},{phase:'end',input:{run_tag:f.run.input.run_tag},remaining_ms:1500});
 const dir=path.join(f.cwd,'control',f.run.run_id,'checker-agents');const manifest=JSON.parse(fs.readFileSync(path.join(dir,fs.readdirSync(dir)[0],'manifest.json')));
 expect(manifest.deadline).toBeLessThanOrEqual(start+1500+20);
 }finally{f.close();}
},5000);
test('expired Checker cannot claim a stopped execution or pass from a hung model',async()=>{
 const f=fixture({mode:'hang'});try{const runtime=await createRuntime({profile:f.profile,run:f.run});
 await expect(runtime.checkActivity(f.activity,{outputs:{}},{phase:'end',input:{run_tag:f.run.input.run_tag},remaining_ms:300})).rejects.toThrow('checker_execution_unconfirmed');
 const dir=path.join(f.cwd,'control',f.run.run_id,'checker-agents'),child=path.join(dir,fs.readdirSync(dir)[0]);
 const result=JSON.parse(fs.readFileSync(path.join(child,'result.json')));expect(result.transport.execution_stopped).toBe(false);expect(result.transport.exit_code).not.toBe(0);
 }finally{f.close();}
},10000);

test.each([
 [undefined,['start','end']],
 ['completion_only',['end']],
])('Commander uses exactly the configured Checker phases: %s',async(phasePolicy,phases)=>{
 const f=fixture({mode:'runner'}),old=process.env.DBOS_DURABLE_ENABLED;try{
 Object.assign(f.activity,{order:1,failure:{empty_ok:[],retryable:[],fatal:[],needs_human:{cases:[]}}});f.activity.runtime.entry='unused.mjs';
 if(phasePolicy==='completion_only'){
  f.profile.skill_runtime.activities[f.activity.key].checker.phase_policy=phasePolicy;
  delete f.activity.acceptance.document.preconditions;
  f.activity.acceptance.source.contract_digest=digest(f.activity.acceptance.document);
  f.activity.acceptance.criteria=f.activity.acceptance.criteria.filter(c=>c.phase==='end');
 }
 Object.assign(f.run,{schema_version:1,runtime_revision:'a'.repeat(64),commander_timeout_ms:1000});
 const ledger=createRunLedger({directory:path.join(fs.realpathSync(f.cwd),'ledger'),identity:{task_id:f.run.task_id,run_id:f.run.run_id}});
 const rt=await createRuntime({profile:f.profile,run:f.run,ledger}),records=new Map();
 dbos.initialized=false;configureCommanderWorkflow({...rt,ledger,revision:f.run.runtime_revision,verifySource:async()=>{},
 decide:async r=>Object.fromEntries([...['protocol','run_id','definition_sha256','sequence','state_sha256'].map(k=>[k,r[k]]),...Object.entries(r.allowed_actions[0]),['reason','Follow fixed contract']]),
 actionStore:{reserve:async(identity,{deadline_ms})=>{const record={identity,deadline_ms,state:'reserved'};records.set(identity.action_id,record);return {created:true,record};},settle:async(identity,result)=>{records.get(identity.action_id).result=result;return result;}}});
 dbos.initialized=true;process.env.DBOS_DURABLE_ENABLED='true';
 const result=await (await startCommanderWorkflow(f.run)).handle.getResult();
 const calls=fs.readFileSync(path.join(f.cwd,'checker-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 expect(calls.map(c=>c.request.phase)).toEqual(phases);expect(result.status).toBe('completed');
 expect(result.outputs.number).toBe(42);expect(ledger.snapshot().calls.filter(c=>c.role==='checker')).toHaveLength(phases.length);
 }finally{dbos.initialized=false;if(old===undefined)delete process.env.DBOS_DURABLE_ENABLED;else process.env.DBOS_DURABLE_ENABLED=old;f.close();}
},20000);

test.each([
 ['readonly-repair',2,'completed',null],
 ['readonly-repair-exhausted',3,'needs_review','checker_repair_exhausted'],
 ['readonly-repair-missing',1,'needs_review','commander_activity_unverified'],
])('Commander and actual Checker use the read-only repair policy: %s',async(mode,attempts,status,escalationReason)=>{
 const f=fixture({mode}),old=process.env.DBOS_DURABLE_ENABLED;
 try{
  f.activity.order=1;
  f.activity.failure={empty_ok:[],retryable:[],fatal:[],needs_human:{cases:[]}};
  f.activity.runtime.entry='unused.mjs';
  f.activity.runtime.checker_repair={max_attempts:3,retry_safe:true,effect_scope:'read_only'};
  f.activity.budget.max_duration_s=20;
  Object.assign(f.run,{schema_version:1,runtime_revision:'b'.repeat(64),commander_timeout_ms:1000,deadline_ms:Date.now()+22000});
  const ledger=createRunLedger({directory:path.join(fs.realpathSync(f.cwd),'ledger'),identity:{task_id:f.run.task_id,run_id:f.run.run_id}});
  const runtime=await createRuntime({profile:f.profile,run:f.run,ledger});
  const records=new Map(),decisions=[];
  dbos.initialized=false;
  configureCommanderWorkflow({...runtime,ledger,revision:f.run.runtime_revision,verifySource:async()=>{},
   decide:async request=>{
    decisions.push(request);
    return Object.fromEntries([...['protocol','run_id','definition_sha256','sequence','state_sha256'].map(k=>[k,request[k]]),
     ...Object.entries(request.allowed_actions[0]),['reason','Follow frozen contract']]);
   },
   actionStore:{reserve:async(identity,{deadline_ms})=>{
    const record={identity,deadline_ms,state:'reserved'};
    records.set(identity.action_id,record);
    return {created:true,record};
   },settle:async(identity,result)=>{records.get(identity.action_id).result=result;return result;}}});
  dbos.initialized=true;process.env.DBOS_DURABLE_ENABLED='true';
  const result=await (await startCommanderWorkflow(f.run)).handle.getResult();
  expect(result.status).toBe(status);
  const calls=fs.readFileSync(path.join(f.cwd,'executor-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  expect(calls).toHaveLength(attempts);
  expect(records.size).toBe(attempts);
  expect(new Set([...records.values()].map(record=>record.deadline_ms)).size).toBe(1);
  const failure=decisions.find(request=>request.failure)?.failure;
  if(escalationReason){
   expect(failure?.reason).toBe(escalationReason);
   expect(failure?.attempt_history).toHaveLength(attempts);
   expect(failure?.checker_feedback?.attempt).toBe(attempts);
  }else{
   expect(failure).toBeUndefined();
   expect(result.outputs.number).toBe(42);
  }
  for(const call of calls.slice(1)){
   expect(call.argv).toContain('resume');
   expect(call.argv).toContain('execution-thread');
   expect(call.prompt).toContain('Observed contradiction');
  }
 }finally{
  dbos.initialized=false;
  if(old===undefined)delete process.env.DBOS_DURABLE_ENABLED;else process.env.DBOS_DURABLE_ENABLED=old;
  f.close();
 }
},25000);

test('same-attempt admission rejects changed input, cancellation, and source drift before execution',async()=>{
 for(const mutation of ['input','cancel','source','deadline','attempt','contract']){
 const f=fixture({mode:'runner'});try{
 const rt=await createRuntime({profile:f.profile,run:f.run}),input={run_tag:f.run.input.run_tag,action_id:'bound',execution_attempt:1};
 await rt.checkActivity(f.activity,null,{phase:'start',input,remaining_ms:mutation==='deadline'?1000:5000});
 const control=new AbortController();if(mutation==='input')input.extra='changed';if(mutation==='cancel')control.abort();
 if(mutation==='contract')f.activity.title='Changed frozen activity';
 if(mutation==='source')fs.appendFileSync(path.join(f.cwd,'skill.txt'),' drift');if(mutation==='deadline')await new Promise(r=>setTimeout(r,1100));
 await expect(rt.executeActivity(f.activity,input,{identity:{task_id:f.run.task_id,run_id:f.run.run_id,activity_key:f.activity.key,action_id:'bound',attempt:mutation==='attempt'?2:1},cwd:f.cwd,signal:control.signal,deadlineMs:Date.now()+5000})).rejects.toThrow(/checker_admission_|commander_source_drift/);
 expect(fs.existsSync(path.join(f.cwd,'control',f.run.run_id,'actions','bound'))).toBe(false);
 expect(fs.readFileSync(path.join(f.cwd,'checker-calls.jsonl'),'utf8').trim().split('\n')).toHaveLength(1);
 }finally{f.close();}}
},15000);
test('end admission requires the actual returned object and unchanged nonce receipts',async()=>{
 for(const mutation of ['copy','mutate','receipt']){
 const f=fixture({mode:'runner'});try{
 const rt=await createRuntime({profile:f.profile,run:f.run}),input={run_tag:f.run.input.run_tag,action_id:'bound',execution_attempt:1};
 const result=await rt.executeActivity(f.activity,input,{identity:{task_id:f.run.task_id,run_id:f.run.run_id,activity_key:f.activity.key,action_id:'bound'},cwd:f.cwd,deadlineMs:Date.now()+8000});
 let supplied=result;if(mutation==='copy')supplied=structuredClone(result);if(mutation==='mutate')result.outputs.number=99;
 if(mutation==='receipt')fs.appendFileSync(result.evidence[0],' ');
 await expect(rt.checkActivity(f.activity,supplied,{phase:'end',input,remaining_ms:3000})).rejects.toThrow('checker_admission_unbound');
 expect(fs.readFileSync(path.join(f.cwd,'checker-calls.jsonl'),'utf8').trim().split('\n')).toHaveLength(2);
 }finally{f.close();}}
},15000);
test('fresh runtime recovery reads new evidence once, then its own completion callback consumes it',async()=>{
 const f=fixture({mode:'runner'});try{
 const input={run_tag:f.run.input.run_tag,action_id:'bound',execution_attempt:1},options={identity:{task_id:f.run.task_id,run_id:f.run.run_id,activity_key:f.activity.key,action_id:'bound'},cwd:f.cwd,deadlineMs:Date.now()+8000};
 const first=await createRuntime({profile:f.profile,run:f.run});await first.executeActivity(f.activity,input,options);
 const recovered=await createRuntime({profile:f.profile,run:f.run});const observation=await recovered.inspectActivity(f.activity,input,options);
 expect(observation.state).toBe('completed');expect((await recovered.checkActivity(f.activity,observation.result,{phase:'end',input,remaining_ms:3000})).verdict).toBe('pass');
 const calls=fs.readFileSync(path.join(f.cwd,'checker-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 expect(calls.map(c=>c.request.phase)).toEqual(['start','end','end']);expect(calls[1].request.nonce).not.toBe(calls[2].request.nonce);
 }finally{f.close();}
},10000);

test.each(['normal','unknown-after-exec'])('Agent %s feedback cannot bypass one-shot admission for a later callback',async mode=>{
 const f=fixture({mode});try{
 const rt=await createRuntime({profile:f.profile,run:f.run}),input={run_tag:f.run.input.run_tag,action_id:'bound',execution_attempt:1};
 const result=await rt.executeActivity(f.activity,input,{identity:{task_id:f.run.task_id,run_id:f.run.run_id,activity_key:f.activity.key,action_id:'bound'},cwd:f.cwd,deadlineMs:Date.now()+8000});
 await rt.checkActivity(f.activity,result,{phase:'end',input,remaining_ms:3000});
 await rt.checkActivity(f.activity,structuredClone(result),{phase:'end',input:{...input,action_id:'other',extra:'changed'},remaining_ms:3000});
 expect(fs.readFileSync(path.join(f.cwd,'checker-calls.jsonl'),'utf8').trim().split('\n')).toHaveLength(3);
 }finally{f.close();}
},10000);
test('serialized completed result is independently checked once after restart without rewriting business output',async()=>{
 const f=fixture({mode:'runner'});try{
 const input={run_tag:f.run.input.run_tag,action_id:'bound',execution_attempt:1},options={identity:{task_id:f.run.task_id,run_id:f.run.run_id,activity_key:f.activity.key,action_id:'bound'},cwd:f.cwd,deadlineMs:Date.now()+8000};
 const first=await createRuntime({profile:f.profile,run:f.run});const saved=JSON.stringify(await first.executeActivity(f.activity,input,options));
 const second=await createRuntime({profile:f.profile,run:f.run}),result=JSON.parse(saved);
 expect((await second.checkActivity(f.activity,result,{phase:'end',input,remaining_ms:3000})).verdict).toBe('pass');
 expect(JSON.stringify(result)).toBe(saved);
 const calls=fs.readFileSync(path.join(f.cwd,'checker-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 expect(calls.map(c=>c.request.phase)).toEqual(['start','end','end']);
 expect(calls[2].request.proposal.outputs).toEqual(result.outputs);
 expect(calls[2].prompt).toContain('不得改写');
 }finally{f.close();}
},10000);

test('fresh check of a serialized wrong delivered output fails even when current facts meet the Contract',async()=>{
 const f=fixture({mode:'runner'});try{
 const rt=await createRuntime({profile:f.profile,run:f.run}),input={run_tag:f.run.input.run_tag};
 const result={schema_version:1,run_tag:input.run_tag,status:'completed',outputs:{number:8},metrics:{},evidence:[]};
 const check=await rt.checkActivity(f.activity,JSON.parse(JSON.stringify(result)),{phase:'end',input,remaining_ms:3000});
 expect(check.verdict).toBe('fail');expect(check.evidence.some(c=>c.status==='failed')).toBe(true);
 expect(fs.readFileSync(path.join(f.cwd,'checker-calls.jsonl'),'utf8').trim().split('\n')).toHaveLength(1);
 expect(fs.existsSync(path.join(f.cwd,'control',f.run.run_id,'actions'))).toBe(false);
 }finally{f.close();}
},5000);

test('完工验收模式只启动一次 Checker，并拒绝遗留的开工验收条款',async()=>{
 const f=fixture({mode:'runner'});
 try{
  const {activity}=f,checker=f.profile.skill_runtime.activities[activity.key].checker;
  checker.phase_policy='completion_only';
  const runtime=await createRuntime({profile:f.profile,run:f.run});
  const input={run_tag:f.run.input.run_tag,action_id:'test-single-check',execution_attempt:1};
  const options={identity:{task_id:f.run.task_id,run_id:f.run.run_id,activity_key:activity.key,action_id:input.action_id},cwd:f.cwd,deadlineMs:Date.now()+10000};
  await expect(runtime.checkActivity(activity,null,{phase:'start',input})).rejects.toThrow('checker_start_requirements_unassigned');
  delete activity.acceptance.document.preconditions;
  activity.acceptance.source.contract_digest=digest(activity.acceptance.document);
  activity.acceptance.criteria=activity.acceptance.criteria.filter(c=>c.phase==='end');
  expect(await runtime.checkActivity(activity,null,{phase:'start',input})).toMatchObject({verdict:'pass'});
  const result=await runtime.executeActivity(activity,input,options);
  expect(result.status).toBe('completed');
  expect(await runtime.checkActivity(activity,result,{phase:'end',input})).toMatchObject({verdict:'pass'});
  const calls=fs.readFileSync(path.join(f.cwd,'checker-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  expect(calls.map(call=>call.request.phase)).toEqual(['end']);
 }finally{f.close();}
},20000);

test.each([
 ['delivery','number','source',null],
 ['delivery-existing-evidence','number','source',null],
 ['delivery','number','receipt','receipt'],
 ['delivery-existing-evidence','number','receipt','receipt'],
 ['delivery','total','source','total']
])('同一个交件入口按契约归档或拒绝缺项：%s／%s／%s',async(mode,requiredOutput,requiredEvidence,missing)=>{
 const f=fixture({mode});
 try{
  const {run,profile,activity}=f;
  const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
  activity.acceptance.document.delivery={
   schema:object({outputs:object({[requiredOutput]:{type:'integer'}}),evidence:object({run:object({[requiredEvidence]:{type:'string'}})})})
  };
  activity.acceptance.source.contract_digest=digest(activity.acceptance.document);
  const runtime=await createRuntime({profile,run});
  const input={run_tag:run.input.run_tag,execution_attempt:1,action_id:'deliver-once'};
  const result=await runtime.executeActivity(activity,input,{identity:{task_id:run.task_id,run_id:run.run_id,activity_key:activity.key,action_id:input.action_id},cwd:f.cwd,deadlineMs:run.deadline_ms});
  const base=path.join(f.cwd,'control',run.run_id,'actions',input.action_id);
  const calls=()=>fs.readFileSync(path.join(f.cwd,'checker-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  if(!missing){
   expect(result.status).toBe('completed');
   const handoff=JSON.parse(fs.readFileSync(path.join(base,'handoff','manifest.json'),'utf8'));
   expect(handoff.outputs).toEqual({number:42});
   expect(handoff.identity).toMatchObject({run_id:run.run_id,activity_key:activity.key});
   const source=handoff.evidence.run.source;
   expect(hash(path.join(base,'handoff',source.file))).toBe(source.sha256);
   expect(calls().at(-1).request.proposal.delivery_sha256).toBe(digest(handoff));
   expect(calls().at(-1).argv.some(arg=>arg.includes('"read_archive"'))).toBe(true);
   const reviewed=calls().at(-1).request.proposal.delivery_evidence.run.source;
   expect(reviewed.archive_path).toMatch(/handoff\/files\//);
   const receipts=fs.readdirSync(path.join(base,'handoff','files'));
   expect(receipts).toEqual([source.sha256]);
  }else{
   expect(result).toMatchObject({status:'needs_review',reason_code:'skill_handoff_incomplete',outputs:{}});
   expect(calls().map(c=>c.request.phase)).toEqual(['start']);
   expect(JSON.parse(fs.readFileSync(result.evidence[0],'utf8')).message).toContain(missing);
   expect(await runtime.checkActivity(activity,structuredClone(result),{phase:'end',input})).toMatchObject({verdict:'unknown',reason:'skill_handoff_incomplete'});
   expect(calls()).toHaveLength(1);
  }
 }finally{f.close();}
},15000);

test('只归档当前动作产生的已验证宿主工具 JSON 回执',async()=>{
 const f=fixture();try{
  const cwd=fs.realpathSync(f.cwd),directory=path.join(cwd,'action'),hostDir=path.join(directory,'host-tools');
  fs.mkdirSync(directory,{mode:0o700});
  const identity={run_id:f.run.run_id,activity_key:f.activity.key,action_id:'current-action'};
  const inputFile=path.join(directory,'activity-input.json'),deadlineMs=f.run.deadline_ms;
  fs.writeFileSync(inputFile,JSON.stringify({identity,activity_key:f.activity.key}),{mode:0o600});
  const entry=path.join(cwd,'host.cjs');
  fs.writeFileSync(entry,"process.stdout.write(JSON.stringify({state:'terminal',value:42}))",{mode:0o600});
  const binding=prepareHostTools({config:{command:process.execPath,command_sha256:hash(process.execPath),entry:'host.cjs',
    kinds:['fixture'],response_paths:['value'],timeout_ms:1000},cwd,files:{'host.cjs':hash(entry)},identity,
    activityKey:f.activity.key,inputFile,directory:hostDir,deadlineMs});
  fs.writeFileSync(path.join(directory,'host-tools-binding.json'),JSON.stringify(binding),{mode:0o600});
  const result=await createHostToolCaller(binding).call({kind:'fixture',action_name:'produced',args:[]});
  const source=path.relative(cwd,result.evidence_ref);
  const args={delivery:{schema:{type:'object'}},identity,config:{roots:['evidence']},cwd,directory,deadlineMs};
  const proposal=ref=>({outputs:{number:42},handoff:{run:{receipt:ref}}});
  expect(()=>archiveActivityHandoff({...args,proposal:proposal(source+'.stdout')})).toThrow();
  const foreign=path.join(cwd,'another-action','host-tools');
  fs.mkdirSync(foreign,{recursive:true,mode:0o700});
  fs.copyFileSync(result.evidence_ref,path.join(foreign,'produced.json'));
  expect(()=>archiveActivityHandoff({...args,proposal:proposal('another-action/host-tools/produced.json')})).toThrow();
  expect(()=>archiveActivityHandoff({...args,identity:{...identity,action_id:'other-action'},proposal:proposal(source)})).toThrow();
  const raw=fs.readFileSync(result.evidence_ref+'.stdout');
  fs.appendFileSync(result.evidence_ref+'.stdout',' ');
  expect(()=>archiveActivityHandoff({...args,proposal:proposal(source)})).toThrow('delivery_host_receipt_unverified');
  fs.writeFileSync(result.evidence_ref+'.stdout',raw);
  const archived=archiveActivityHandoff({...args,proposal:proposal(source)});
  expect(archived.evidence.run.receipt).toMatchObject({source,sha256:hash(result.evidence_ref)});
  expect(JSON.parse(fs.readFileSync(path.join(directory,'handoff',archived.evidence.run.receipt.file))).response.output).toEqual({value:42});
 }finally{f.close();}
},10000);

test('保留可归档原件，记录可选裸文件名，必需原件缺失仍拒绝',()=>{
 const f=fixture();try{
  const directory=path.join(f.cwd,'action');fs.mkdirSync(directory);
  const fields={receipt:{type:'string'},native_identifier:{type:'string'}};
  const schema=required=>({type:'object',required:['outputs','evidence'],properties:{
   outputs:{type:'object'},evidence:{type:'object',required:['account'],properties:{
    account:{type:'object',properties:fields,required,additionalProperties:false}}}}});
  const proposal={outputs:{number:42},handoff:{account:{receipt:'evidence/fact.json',native_identifier:'remote-account.xml'}}};
  const args={identity:{run_id:f.run.run_id,activity_key:f.activity.key},config:{roots:['evidence']},
   cwd:f.cwd,directory,deadlineMs:f.run.deadline_ms,proposal};
  expect(()=>archiveActivityHandoff({...args,delivery:{schema:schema(['receipt','native_identifier'])}})).toThrow();
  expect(()=>archiveActivityHandoff({...args,proposal:{outputs:{number:42},handoff:{account:{native_identifier:'remote-account.xml'}}},
    delivery:{schema:schema([])}})).toThrow('delivery_evidence_unqualified');
  const manifest=archiveActivityHandoff({...args,delivery:{schema:schema(['receipt'])}});
  expect(Object.keys(manifest.evidence.account)).toEqual(['receipt']);
  expect(manifest.unresolved_evidence).toEqual([{scope:'account',role:'native_identifier',source:'remote-account.xml'}]);
  expect(archiveActivityHandoff({...args,delivery:{schema:schema(['receipt'])}})).toEqual(manifest);
 }finally{f.close();}
});

test('逐项交付必须按输出 ID 配齐证据，拒绝缺失或多列的证据组',()=>{
 const f=fixture();
 try{
  const directory=path.join(f.cwd,'action');
  fs.mkdirSync(directory);
  const args={
   delivery:{schema:{type:'object'},item_scope:{collection:'Video',id_field:'video_id'}},
   identity:{run_id:f.run.run_id,activity_key:f.activity.key},
   proposal:{outputs:{Video:[{video_id:'video-one'}]},handoff:{run:{},'video-two':{raw:'evidence/fact.json'}}},
   config:{roots:['evidence']},cwd:f.cwd,directory,deadlineMs:f.run.deadline_ms
  };
  expect(()=>archiveActivityHandoff(args)).toThrow('delivery_item_evidence_missing:video-one');
  expect(fs.existsSync(path.join(directory,'handoff'))).toBe(false);
  args.proposal.handoff['video-one']=args.proposal.handoff['video-two'];
  expect(()=>archiveActivityHandoff(args)).toThrow('delivery_item_evidence_unexpected:video-two');
  delete args.proposal.handoff['video-two'];
  const result=archiveActivityHandoff(args);
  expect(result.evidence['video-one'].raw.sha256).toBeTruthy();
 }finally{f.close();}
});

test('交件可归档 100 条输出各自的 4 项证据和 5 项共享证据',()=>{
 const f=fixture();
 try{
  const directory=path.join(f.cwd,'action');
  fs.mkdirSync(directory);
  const roles=count=>Object.fromEntries(Array.from({length:count},(_,index)=>[`role-${index}`,'evidence/fact.json']));
  const outputs={rows:Array.from({length:100},(_,index)=>({id:`row-${index}`}))};
  const handoff={run:roles(5),...Object.fromEntries(outputs.rows.map(({id})=>[id,roles(4)]))};
  const result=archiveActivityHandoff({
   delivery:{schema:{type:'object'},item_scope:{collection:'rows',id_field:'id'}},
   identity:{run_id:f.run.run_id,activity_key:f.activity.key},proposal:{outputs,handoff},
   config:{roots:['evidence']},cwd:f.cwd,directory,deadlineMs:f.run.deadline_ms
  });
  expect(Object.values(result.evidence).reduce((count,group)=>count+Object.keys(group).length,0)).toBe(405);
 }finally{f.close();}
});

test('有真实交件的两次 Checker 超时后保留未知，不再拿空结果验收',async()=>{
 const f=fixture({mode:'delivery-timeout'});
 try{
  const {activity,profile,run}=f;
  profile.skill_runtime.activities[activity.key].checker.timeout_ms=1200;
  activity.acceptance.document.delivery={schema:{type:'object'}};
  activity.acceptance.source.contract_digest=digest(activity.acceptance.document);
  const runtime=await createRuntime({profile,run});
  const input={run_tag:run.input.run_tag,action_id:'delivery-checker-timeout',execution_attempt:1};
  const identity={task_id:run.task_id,run_id:run.run_id,activity_key:activity.key,action_id:input.action_id};
  const result=await runtime.executeActivity(activity,input,{identity,cwd:f.cwd,deadlineMs:run.deadline_ms});
  expect(result).toMatchObject({status:'needs_review',reason_code:'skill_readback_unconfirmed'});
  expect(await runtime.checkActivity(activity,result,{phase:'end',input})).toMatchObject({verdict:'unknown',reason:'skill_readback_unconfirmed'});
  const calls=fs.readFileSync(path.join(f.cwd,'checker-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse).map(x=>x.request);
  expect(calls.map(x=>x.phase)).toEqual(['start','end','end']);
  expect(calls.slice(1).every(x=>x.proposal.delivery_sha256&&x.proposal.outputs.number===42)).toBe(true);
 }finally{f.close();}
},15000);

test('按作用域读取原件且只压缩与归档字节完全相同的重复内嵌内容',()=>{
 const f=fixture();
 try{
  const root='evidence/archive';
  fs.mkdirSync(path.join(f.cwd,root));
  const raw='<node>'+('原件'.repeat(2000))+'</node>';
  const copy='<node>'+('另一个原件'.repeat(1000))+'</node>';
  const receipt=JSON.stringify({result:{stdout:JSON.stringify({embedded:raw,distinct:'不同',other:copy})}});
  const install=text=>{
   const sha256=createHash('sha256').update(text).digest('hex');
   const archive_path=path.join(root,sha256);
   fs.writeFileSync(path.join(f.cwd,archive_path),text);
   return {sha256,archive_path};
  };
  const archive=install(raw), report=install(receipt);
  const binding=prepareCheckerEvidence({
   config:{roots:[root],archive_root:root},cwd:f.cwd,directory:path.join(f.cwd,'output'),
   request:{nonce:randomUUID(),proposal:{delivery_evidence:{camera:{report,archive},unrelated:{file:archive}}}},
   deadlineMs:Date.now()+5000
  });
  const content=readCheckerArchive(binding,{scope:'camera'}).map(x=>JSON.parse(x.text));
  expect(content.map(x=>x.role)).toEqual(['report','archive']);
  expect(JSON.parse(content[0].text).result.stdout).toEqual({embedded:{archive_content_sha256:archive.sha256},distinct:'不同',other:copy});
  expect(checkerEvidenceReceipts(binding).find(x=>x.path===report.archive_path).text).toBe(receipt);
  expect(()=>readCheckerArchive(binding,{scope:'missing'})).toThrow('checker_evidence_archive_scope_invalid');
  fs.writeFileSync(path.join(f.cwd,archive.archive_path),'changed');
  expect(()=>readCheckerEvidence(binding,{path:archive.archive_path})).toThrow('checker_evidence_archive_drift');
 }finally{f.close();}
});
