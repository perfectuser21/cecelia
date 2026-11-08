import {test,expect} from 'vitest';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const {createWorkflowRunner,profileDigest}=createRequire(import.meta.url)('./workflow-runner.cjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture({closeUnknown=false,badRef=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-domain-'));
 const code=`import fs from 'node:fs';import path from 'node:path';
 const live=new WeakMap();
 export function createWorkflowDomain({identity,profile,runDirectory,signal,recordEvidence,deadline_ms,cleanup_deadline_ms}){
  const resource={};live.set(resource,41);fs.appendFileSync(path.join(profile.cwd,'factories'),'x');
  fs.writeFileSync(path.join(profile.cwd,'identity.json'),JSON.stringify({identity,runDirectory,signal:signal instanceof AbortSignal,deadline_ms,cleanup_deadline_ms}));
  return {
   prepareInput:async(a,value)=>({...value,prepared:true}),
   executeActivity:async(a,input,options)=>{if(options.signal!==signal||!input.prepared)throw Error('context_missing');fs.appendFileSync(path.join(profile.cwd,'effects'),'x');await recordEvidence({event_type:'DOMAIN_OBSERVATION',activity:a.key,evidence:[{actual:true}]});return {schema_version:1,run_tag:input.run_tag,status:'completed',outputs:{answer:live.get(resource)+1},metrics:{},evidence:[{actual:true}]};},
   checkActivity:async(a,result,options)=>({verdict:options.phase==='start'||fs.readFileSync(path.join(profile.cwd,'effects'),'utf8')==='x'?'pass':'fail',acceptance_ref:${badRef?"'wrong'":"options.acceptance.ref"},evidence:[{independent:true}]}),
   validateWorkflow:async(p,receipt,options)=>({verdict:receipt.outputs.answer===42?'pass':'fail',acceptance_ref:options.acceptance.ref,evidence:[{independent:true}]}),
   close:async()=>{fs.appendFileSync(path.join(profile.cwd,'closes'),'x');return {execution_stopped:${!closeUnknown}};}
  };
 }`;
 fs.writeFileSync(path.join(root,'domain.mjs'),code);
 const uid=()=>randomUUID(),m={activity_id:uid(),executor_kind:'code',questions:{}};
 const profile={cwd:root,files:{'domain.mjs':hash(code)},domain_adapter:{protocol:'workflow-domain/v1',entry:'domain.mjs',export_name:'createWorkflowDomain',budget:{max_duration_s:5,cleanup_grace_s:1},config:{}},contract:{workflow:'domain-test',activities:[{key:'work',order:1,budget:{max_duration_s:3,heartbeat_s:1},failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:[]}},runtime:{protocol:'json-stdio-v1',phase:'source',entry:'domain.mjs'}}]},metadata:{work:m},preconditions:{work:{entry:'domain.mjs',acceptance:{ref:'start@1'}}},validators:{work:{entry:'domain.mjs',acceptance:{ref:'end@1'}},workflow:{entry:'domain.mjs',acceptance:{ref:'workflow@1'}}}};
 m.questions=Object.fromEntries(['A1','A2','A3','A4','A5','A6','B1'].map(q=>[q,{ref:q==='A2'?'start@1':q==='A4'?'end@1':q+'@1',version:'1',declared:{value:q}}]));
 m.identity={identity_protocol:2,workflow_id:uid(),reference_id:uid(),workflow_definition_version_id:uid(),activity_definition_version_id:uid()};
 const binding={run_binding_id:uid(),workflow_id:m.identity.workflow_id,workflow_definition_version_id:m.identity.workflow_definition_version_id,attempt_key:uid(),activities:{work:{activity_id:m.activity_id,reference_id:m.identity.reference_id,activity_definition_version_id:m.identity.activity_definition_version_id}}};
 const id={run_id:uid(),task_id:uid(),profile:'fixed',input:{run_tag:'domain-test',entry:'untrusted.mjs'},mode:'formal',run_binding:binding,profile_sha256:profileDigest(profile)};
 const events=[],r=createWorkflowRunner({stateRoot:path.join(root,'state'),machineId:'fixture',profiles:{fixed:profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:()=>({onEvent:async e=>events.push(e),recordValidation:async()=>{},finalize:async()=>{},flush:async()=>({pending:0,blocked:0})})});
 return {root,profile,id,r,events};
}
async function terminal(f){for(let i=0;i<300;i++){const s=await f.r.inspect(f.id);if(!['running','starting','validating'].includes(s.status))return s;await new Promise(r=>setTimeout(r,10));}throw Error('terminal_not_observed');}
async function withFixture(options,work){const f=fixture(options);try{await work(f);}finally{f.r.close();fs.rmSync(f.root,{recursive:true,force:true});}}
test('公共Runner同进程domain工厂只建一次，正式identity及独立判词复用原链',()=>withFixture({},async f=>{
 await f.r.start(f.id);await f.r.start(f.id);const s=await terminal(f);
 expect(s.status).toBe('completed');expect(s.validation.activities.work.verdict).toBe('pass');
 expect(fs.readFileSync(path.join(f.root,'factories'),'utf8')).toBe('x');expect(fs.readFileSync(path.join(f.root,'effects'),'utf8')).toBe('x');expect(fs.readFileSync(path.join(f.root,'closes'),'utf8')).toBe('x');
 const context=JSON.parse(fs.readFileSync(path.join(f.root,'identity.json'),'utf8'));
 expect(context.cleanup_deadline_ms-context.deadline_ms).toBe(1000);expect(context.deadline_ms).toBeGreaterThan(Date.now()-5000);expect(context.identity).toEqual(f.id);expect(context.signal).toBe(true);expect(context.runDirectory).toBe(path.join(f.root,'state',f.id.run_id));
 expect(f.events.some(e=>e.event_type==='DOMAIN_OBSERVATION')).toBe(true);expect(f.events.filter(e=>e.event_type==='ACTIVITY_STARTED')).toHaveLength(1);
}));
test('domain close未知保留unknown与execution.lock，不允许下一run进入',()=>withFixture({closeUnknown:true},async f=>{
 await f.r.start(f.id);const s=await terminal(f);expect(s.status).toBe('unknown');expect(s.execution_unknown).toBe(true);
 expect(fs.existsSync(path.join(f.root,'state','execution.lock'))).toBe(true);
 expect((await f.r.start({...f.id,run_id:randomUUID()})).status).toBe('waiting_resources');
}));
test('domain独立判词不匹配固定acceptance不能通过正式验收',()=>withFixture({badRef:true},async f=>{
 await f.r.start(f.id);expect((await terminal(f)).status).not.toBe('completed');expect(fs.existsSync(path.join(f.root,'effects'))).toBe(false);
}));
test('domain协议和入口必须受保护固定，不能由请求选择或遗漏源摘要',()=>withFixture({},async f=>{
 f.profile.domain_adapter.protocol='other';f.id.profile_sha256=profileDigest(f.profile);await expect(f.r.start(f.id)).rejects.toThrow('domain');
 f.profile.domain_adapter.protocol='workflow-domain/v1';f.profile.domain_adapter.entry='missing.mjs';f.id.profile_sha256=profileDigest(f.profile);await expect(f.r.start(f.id)).rejects.toThrow();
 expect(fs.existsSync(path.join(f.root,'effects'))).toBe(false);
}));
function changeSource(f,edit){const file=path.join(f.root,'domain.mjs'),source=edit(fs.readFileSync(file,'utf8'));fs.writeFileSync(file,source);f.profile.files['domain.mjs']=hash(source);f.id.profile_sha256=profileDigest(f.profile);}
test('domain源码漂移在执行前拒绝，formal题目缺失不能因domain而放宽',()=>withFixture({},async f=>{
 const a2=f.profile.metadata.work.questions.A2;delete f.profile.metadata.work.questions.A2;f.id.profile_sha256=profileDigest(f.profile);await expect(f.r.start(f.id)).rejects.toThrow('formal_precondition_required');
 f.profile.metadata.work.questions.A2=a2;f.id.profile_sha256=profileDigest(f.profile);fs.appendFileSync(path.join(f.root,'domain.mjs'),'\n// drift');await expect(f.r.start(f.id)).rejects.toThrow('source_mismatch');
 expect(fs.existsSync(path.join(f.root,'factories'))).toBe(false);
}));
test('domain挂起调用预算到期保留未知，即使close声称停止也不释放未决调用',()=>withFixture({},async f=>{
 changeSource(f,s=>s.replace("if(options.signal!==signal", "await new Promise(()=>{});if(options.signal!==signal"));
 f.profile.domain_adapter.budget={max_duration_s:1,cleanup_grace_s:1};f.id.profile_sha256=profileDigest(f.profile);
 await f.r.start(f.id);const s=await terminal(f);expect(s.status).toBe('unknown');expect(s.execution_unknown).toBe(true);expect(fs.existsSync(path.join(f.root,'state','execution.lock'))).toBe(true);
 const persisted=JSON.parse(fs.readFileSync(path.join(f.root,'state',f.id.run_id+'.json'),'utf8'));
 await f.r.start(f.id);expect(JSON.parse(fs.readFileSync(path.join(f.root,'state',f.id.run_id+'.json'),'utf8')).domain_started_at_ms).toBe(persisted.domain_started_at_ms);
}));
test('domain close挂起受固定cleanup截止限制，不能占着validating而不投射unknown',()=>withFixture({},async f=>{
 changeSource(f,s=>s.replace("close:async()=>{", "close:async()=>{await new Promise(()=>{});"));f.profile.domain_adapter.budget={max_duration_s:1,cleanup_grace_s:1};f.id.profile_sha256=profileDigest(f.profile);
 await f.r.start(f.id);const s=await terminal(f);expect(s.status).toBe('unknown');expect(s.execution_unknown).toBe(true);expect(fs.existsSync(path.join(f.root,'state','execution.lock'))).toBe(true);
}));
test('domain cancel使用原signal，close只执行一次且不会自动重建工厂',()=>withFixture({},async f=>{
 changeSource(f,s=>s.replace("fs.appendFileSync(path.join(profile.cwd,'effects'),'x');", "fs.appendFileSync(path.join(profile.cwd,'effects'),'x');await new Promise(r=>signal.addEventListener('abort',r,{once:true}));"));
 await f.r.start(f.id);for(let i=0;!fs.existsSync(path.join(f.root,'effects'))&&i<100;i++)await new Promise(r=>setTimeout(r,10));
 await f.r.cancel(f.id);const s=await terminal(f);expect(s.cancel_requested).toBe(true);expect(s.status).toBe('unknown');expect(fs.readFileSync(path.join(f.root,'closes'),'utf8')).toBe('x');
 await f.r.start(f.id);expect(fs.readFileSync(path.join(f.root,'factories'),'utf8')).toBe('x');
}));
test('domain scope验收ref漂移不得被已通过Activity判词掩盖',()=>withFixture({},async f=>{
 changeSource(f,s=>s.replace("validateWorkflow:async(p,receipt,options)=>({verdict:receipt.outputs.answer===42?'pass':'fail',acceptance_ref:options.acceptance.ref", "validateWorkflow:async(p,receipt,options)=>({verdict:receipt.outputs.answer===42?'pass':'fail',acceptance_ref:'wrong'"));
 await f.r.start(f.id);const s=await terminal(f);expect(s.status).toBe('unverified');expect(s.validation.workflow.verdict).toBe('unknown');expect(s.validation.activities.work.verdict).toBe('pass');
}));
