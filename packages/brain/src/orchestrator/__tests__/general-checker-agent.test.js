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
let prompt='';process.stdin.on('data',b=>prompt+=b);process.stdin.on('end',()=>{
 const input=JSON.parse(fs.readFileSync(process.env.COMMANDER_ACTIVITY_INPUT_FILE));const r=input.checker_request;
 if(!r){if('${mode}'!=='runner')fs.writeFileSync('evidence/fact.json',JSON.stringify({number:0}));if('${mode}'==='unknown-after-exec')fs.rmSync('evidence/fact.json');fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({claimed:'passed',outputs:{number:0}}));console.log(JSON.stringify({type:'thread.started',thread_id:'execution-thread'}));return;}
 if('${mode}'==='hang'){setInterval(()=>{},1000);return;}
 fs.appendFileSync('checker-calls.jsonl',JSON.stringify({argv:process.argv,prompt,request:r})+'\\n');
 const arg=process.argv.find(a=>a.startsWith('mcp_servers.commander_checker_evidence.args='));
 const serverArgs=JSON.parse(arg.slice(arg.indexOf('=')+1));
 const rpc=[{jsonrpc:'2.0',id:1,method:'initialize'},{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'read_file',arguments:{path:'evidence/fact.json'}}}];
 const raw=cp.spawnSync(process.execPath,serverArgs,{input:rpc.map(JSON.stringify).join('\\n')+'\\n',encoding:'utf8'});
 if(raw.status!==0)throw Error('actual_evidence_server_failed:'+raw.stderr);
 const response=JSON.parse(raw.stdout.trim().split('\\n').at(-1));if(response.error)throw Error(JSON.stringify(response.error));
 const observed=JSON.parse(response.result.content[0].text),fact=observed.status==='available'?JSON.parse(observed.text):null;
 const checks=r.criteria.map(c=>{const wanted=c.requirement;let matches=typeof wanted!=='string'?true:wanted.startsWith('number equals ')?fact?.number===Number(wanted.slice(14)):fact?.color===wanted.slice(9);
 if(r.proposal?.schema_version===1&&typeof wanted==='string'&&wanted.startsWith('number equals '))matches=matches&&r.proposal.outputs.number===fact?.number;
 return {id:c.id,status:fact===null?'unknown':matches?'passed':'failed',reason:fact===null?'Evidence unavailable':matches?'Observed requirement':'Observed contradiction',expected:wanted,actual:fact,evidence:[{source:observed.evidence_ref,observation:{value:fact}}]};});
 const outcome=checks.some(c=>c.status==='unknown')?'unknown':checks.some(c=>c.status==='failed')?'failed':'passed';
 const result={identity:Object.fromEntries(['task_id','run_id','run_tag','workflow','activity','attempt'].map(k=>[k,r[k]])),nonce:r.nonce,outcome,checks,output:r.proposal?.outputs??{},retryable:false,external_effect:'none'};
 if('${mode}'==='runner'&&r.phase==='end')result.output={number:42,description:'Verified in '+r.nonce};
 if('${mode}'==='empty')result.outcome='empty';
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

test('complete Commander runner uses one start and one end Checker, never rejudges wording',async()=>{
 const f=fixture({mode:'runner'}),old=process.env.DBOS_DURABLE_ENABLED;try{
 Object.assign(f.activity,{order:1,failure:{empty_ok:[],retryable:[],fatal:[],needs_human:{cases:[]}}});f.activity.runtime.entry='unused.mjs';
 Object.assign(f.run,{schema_version:1,runtime_revision:'a'.repeat(64),commander_timeout_ms:1000});
 const ledger=createRunLedger({directory:path.join(fs.realpathSync(f.cwd),'ledger'),identity:{task_id:f.run.task_id,run_id:f.run.run_id}});
 const rt=await createRuntime({profile:f.profile,run:f.run,ledger}),records=new Map();
 dbos.initialized=false;configureCommanderWorkflow({...rt,ledger,revision:f.run.runtime_revision,verifySource:async()=>{},
 decide:async r=>Object.fromEntries([...['protocol','run_id','definition_sha256','sequence','state_sha256'].map(k=>[k,r[k]]),...Object.entries(r.allowed_actions[0]),['reason','Follow fixed contract']]),
 actionStore:{reserve:async(identity,{deadline_ms})=>{const record={identity,deadline_ms,state:'reserved'};records.set(identity.action_id,record);return {created:true,record};},settle:async(identity,result)=>{records.get(identity.action_id).result=result;return result;}}});
 dbos.initialized=true;process.env.DBOS_DURABLE_ENABLED='true';
 const result=await (await startCommanderWorkflow(f.run)).handle.getResult();
 const calls=fs.readFileSync(path.join(f.cwd,'checker-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 expect(calls.map(c=>c.request.phase)).toEqual(['start','end']);expect(result.status).toBe('completed');
 expect(result.outputs.number).toBe(42);expect(ledger.snapshot().calls.filter(c=>c.role==='checker')).toHaveLength(2);
 }finally{dbos.initialized=false;if(old===undefined)delete process.env.DBOS_DURABLE_ENABLED;else process.env.DBOS_DURABLE_ENABLED=old;f.close();}
},20000);

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
