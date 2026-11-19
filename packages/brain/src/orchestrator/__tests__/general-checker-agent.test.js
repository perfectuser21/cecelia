import {test,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRuntime} from '../../../scripts/commander-workflow/skill-adapter.mjs';
import {digest} from '../commander-decision.js';
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
 if(!r){fs.writeFileSync('evidence/fact.json',JSON.stringify({number:0}));fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({claimed:'passed',outputs:{number:0}}));console.log(JSON.stringify({type:'thread.started',thread_id:'execution-thread'}));return;}
 if('${mode}'==='hang'){setInterval(()=>{},1000);return;}
 fs.appendFileSync('checker-calls.jsonl',JSON.stringify({argv:process.argv,prompt,request:r})+'\\n');
 const arg=process.argv.find(a=>a.startsWith('mcp_servers.commander_checker_evidence.args='));
 const serverArgs=JSON.parse(arg.slice(arg.indexOf('=')+1));
 const rpc=[{jsonrpc:'2.0',id:1,method:'initialize'},{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'read_file',arguments:{path:'evidence/fact.json'}}}];
 const raw=cp.spawnSync(process.execPath,serverArgs,{input:rpc.map(JSON.stringify).join('\\n')+'\\n',encoding:'utf8'});
 if(raw.status!==0)throw Error('actual_evidence_server_failed:'+raw.stderr);
 const response=JSON.parse(raw.stdout.trim().split('\\n').at(-1));if(response.error)throw Error(JSON.stringify(response.error));
 const observed=JSON.parse(response.result.content[0].text),fact=observed.status==='available'?JSON.parse(observed.text):null;
 const checks=r.criteria.map(c=>{const wanted=c.requirement;const matches=typeof wanted!=='string'?true:wanted.startsWith('number equals ')?fact?.number===Number(wanted.slice(14)):fact?.color===wanted.slice(9);
 return {id:c.id,status:fact===null?'unknown':matches?'passed':'failed',reason:fact===null?'Evidence unavailable':matches?'Observed requirement':'Observed contradiction',expected:wanted,actual:fact,evidence:[{source:observed.evidence_ref,observation:{value:fact}}]};});
 const outcome=checks.some(c=>c.status==='unknown')?'unknown':checks.some(c=>c.status==='failed')?'failed':'passed';
 const result={identity:Object.fromEntries(['task_id','run_id','run_tag','workflow','activity','attempt'].map(k=>[k,r[k]])),nonce:r.nonce,outcome,checks,output:r.proposal?.outputs??{},retryable:false,external_effect:'none'};
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
