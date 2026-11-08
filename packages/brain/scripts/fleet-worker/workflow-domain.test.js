import {test,expect} from 'vitest';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const {createWorkflowRunner,profileDigest}=createRequire(import.meta.url)('./workflow-runner.cjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture({closeUnknown=false,badRef=false,useRealRecorder=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-domain-'));
 const code=`import fs from 'node:fs';import path from 'node:path';
 const live=new WeakMap();
 export function createWorkflowDomain({identity,profile,runDirectory,signal,recordEvidence,deadline_ms,cleanup_deadline_ms}){
  const resource={};live.set(resource,41);fs.appendFileSync(path.join(profile.cwd,'factories'),'x');
  fs.writeFileSync(path.join(profile.cwd,'identity.json'),JSON.stringify({identity,profile,runDirectory,signal:signal instanceof AbortSignal,deadline_ms,cleanup_deadline_ms}));
  return {
   prepareInput:async(a,value)=>({...value,prepared:true}),
   executeActivity:async(a,input,options)=>{if(options.signal!==signal||!input.prepared)throw Error('context_missing');fs.appendFileSync(path.join(profile.cwd,'effects'),'x');await recordEvidence({event_type:'ACTIVITY_AGENT_EVENT',activity:a.key,event:{protocol:'workflow-domain-evidence/v1',evidence:[{actual:true}]}});return {schema_version:1,run_tag:input.run_tag,status:'completed',outputs:{answer:live.get(resource)+1},metrics:{},evidence:[{actual:true}]};},
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
 const events=[],r=createWorkflowRunner({stateRoot:path.join(root,'state'),machineId:'fixture',profiles:{fixed:profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:useRealRecorder?async state=>{const {createWorkflowRecorder}=await import('../../src/orchestrator/workflow-recorder.js');return createWorkflowRecorder({root:path.join(root,'journal'),runId:state.identity.run_id,taskId:state.identity.task_id,machineId:'fixture',profileDigest:state.identity.profile_sha256,mode:state.identity.mode,metadata:state.profile.metadata});}:()=>({onEvent:async e=>events.push(e),recordValidation:async()=>{},finalize:async()=>{},flush:async()=>({pending:0,blocked:0})})});
 return {root,profile,id,r,events};
}
async function terminal(f){for(let i=0;i<300;i++){const s=await f.r.inspect(f.id);if(!['running','starting','validating'].includes(s.status))return s;await new Promise(r=>setTimeout(r,10));}throw Error('terminal_not_observed');}
async function withFixture(options,work){const f=fixture(options);try{await work(f);}finally{f.r.close();fs.rmSync(f.root,{recursive:true,force:true});}}
test('公共Runner同进程domain工厂只建一次，正式identity及独立判词复用原链',()=>withFixture({},async f=>{
 await f.r.start(f.id);await f.r.start(f.id);const s=await terminal(f);
 expect(s.status).toBe('completed');expect(s.validation.activities.work.verdict).toBe('pass');
 expect(fs.readFileSync(path.join(f.root,'factories'),'utf8')).toBe('x');expect(fs.readFileSync(path.join(f.root,'effects'),'utf8')).toBe('x');expect(fs.readFileSync(path.join(f.root,'closes'),'utf8')).toBe('x');
 const context=JSON.parse(fs.readFileSync(path.join(f.root,'identity.json'),'utf8'));
 expect(context.cleanup_deadline_ms-context.deadline_ms).toBe(1000);expect(context.deadline_ms).toBeGreaterThan(Date.now()-5000);expect(profileDigest(context.profile)).toBe(f.id.profile_sha256);expect(context.identity).toEqual(f.id);expect(context.signal).toBe(true);expect(context.runDirectory).toBe(path.join(f.root,'state',f.id.run_id));
 expect(f.events.some(e=>e.event_type==='ACTIVITY_AGENT_EVENT'&&e.event?.protocol==='workflow-domain-evidence/v1')).toBe(true);expect(f.events.filter(e=>e.event_type==='ACTIVITY_STARTED')).toHaveLength(1);
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
test('domain只读观察公共Commander真实exchange，close后不再回调domain',()=>withFixture({},async f=>{
 changeSource(f,s=>s.replace('return {\n   prepareInput','let closed=false;return {\n   onEvent:async event=>{if(closed)throw Error(\'closed_domain\');if(event.event_type===\'COMMANDER_EXCHANGE\')fs.appendFileSync(path.join(profile.cwd,\'exchanges\'),JSON.stringify(event)+\'\\n\');},\n   prepareInput').replace("close:async()=>{", "close:async()=>{closed=true;"));
 const commander="console.log('{\"action\":\"none\"}')",skill='只读监督';
 fs.writeFileSync(path.join(f.root,'commander.mjs'),commander);fs.writeFileSync(path.join(f.root,'skill.md'),skill);
 Object.assign(f.profile.files,{'commander.mjs':hash(commander),'skill.md':hash(skill)});f.profile.commander={entry:'commander.mjs',skill:{entry:'skill.md',version:'1'},timeout_s:1};f.id.profile_sha256=profileDigest(f.profile);
 await f.r.start(f.id);expect((await terminal(f)).status).toBe('completed');
 const exchanges=fs.readFileSync(path.join(f.root,'exchanges'),'utf8').trim().split('\n').map(JSON.parse);
 expect(exchanges.length).toBeGreaterThan(0);expect(exchanges.every(e=>e.run_id===f.id.run_id&&e.event_type==='COMMANDER_EXCHANGE')).toBe(true);
 expect(exchanges.every(e=>f.events.some(actual=>actual.cursor===e.cursor&&actual.event_type===e.event_type))).toBe(true);
}));
test('domain取消仍执行原finalize及独立cleanup检查，清场不依赖已取消业务signal',()=>withFixture({},async f=>{
 changeSource(f,s=>s.replace("if(options.signal!==signal||!input.prepared)", "if((a.runtime.phase!=='finalize'&&options.signal!==signal)||!input.prepared)").replace("fs.appendFileSync(path.join(profile.cwd,'effects'),'x');", "if(a.runtime.phase!=='finalize'){fs.appendFileSync(path.join(profile.cwd,'effects'),'x');await new Promise(r=>signal.addEventListener('abort',r,{once:true}));}else{if(options.signal?.aborted)throw Error('cleanup_aborted');fs.writeFileSync(path.join(profile.cwd,'cleaned'),'yes');}").replace("checkActivity:async(a,result,options)=>({verdict:", "checkActivity:async(a,result,options)=>({verdict:a.runtime.phase==='finalize'&&options.signal?.aborted?'unknown':"));
 const clean={...structuredClone(f.profile.contract.activities[0]),key:'release',order:2,runtime:{protocol:'json-stdio-v1',phase:'finalize',entry:'domain.mjs'}};f.profile.contract.activities.push(clean);
 const m=structuredClone(f.profile.metadata.work);m.activity_id=randomUUID();m.identity.reference_id=randomUUID();m.identity.activity_definition_version_id=randomUUID();f.profile.metadata.release=m;
 f.profile.preconditions.release=structuredClone(f.profile.preconditions.work);f.profile.validators.release=structuredClone(f.profile.validators.work);f.profile.validators.cleanup={entry:'domain.mjs',acceptance:{ref:'end@1'}};
 f.id.run_binding.activities.release={activity_id:m.activity_id,reference_id:m.identity.reference_id,activity_definition_version_id:m.identity.activity_definition_version_id};f.id.profile_sha256=profileDigest(f.profile);
 await f.r.start(f.id);for(let i=0;!fs.existsSync(path.join(f.root,'effects'))&&i<100;i++)await new Promise(r=>setTimeout(r,10));await f.r.cancel(f.id);
 const s=await terminal(f);expect(fs.readFileSync(path.join(f.root,'cleaned'),'utf8')).toBe('yes');expect(s.validation.activities.release.verdict).toBe('pass');expect(s.validation.cleanup.verdict).toBe('pass');expect(s.status).toBe('cancelled');
}));
test('domain已接受运行重启仍隔离原identity，不新建工厂或延长budget',()=>withFixture({},async f=>{
 const stateRoot=path.join(f.root,'state');fs.writeFileSync(path.join(stateRoot,f.id.run_id+'.json'),JSON.stringify({identity:f.id,profile:f.profile,status:'running',domain_started_at_ms:123}));fs.mkdirSync(path.join(stateRoot,'execution.lock'));
 const restarted=createWorkflowRunner({stateRoot,machineId:'fixture',profiles:{fixed:f.profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{}});
 try{expect((await restarted.start(f.id)).status).toBe('unknown');expect(fs.existsSync(path.join(f.root,'factories'))).toBe(false);expect(JSON.parse(fs.readFileSync(path.join(stateRoot,f.id.run_id+'.json'),'utf8')).domain_started_at_ms).toBe(123);expect((await restarted.maintenance()).pending).toBe(1);}finally{restarted.close();}
}));
test('cleanup绝对截止已过时连同步close也不得获得新的执行窗口',()=>withFixture({},async f=>{
 const {loadWorkflowDomain}=createRequire(import.meta.url)('./workflow-domain.cjs');
 const startedAt=Date.now()-10000;
 await expect(loadWorkflowDomain({profile:f.profile,identity:f.id,runDirectory:path.join(f.root,'run'),controller:new AbortController(),startedAt,recordEvidence:async()=>{}})).rejects.toThrow('timeout');
 expect(fs.existsSync(path.join(f.root,'factories'))).toBe(false);
}));
test('domain恢复原执行外部效果未知时仍要求固定readback_only声明',()=>withFixture({},async f=>{
 changeSource(f,s=>s.replace('return {\n   prepareInput',"return {\n   recoverActivity:async()=>{fs.writeFileSync(path.join(profile.cwd,'recovery-effect'),'bad');return {};},\n   prepareInput"));
 const {loadWorkflowDomain}=createRequire(import.meta.url)('./workflow-domain.cjs');
 const domain=await loadWorkflowDomain({profile:f.profile,identity:f.id,runDirectory:path.join(f.root,'run'),controller:new AbortController(),startedAt:Date.now(),recordEvidence:async()=>{}});
 try{await expect(domain.recoverActivity(f.profile.contract.activities[0],f.id.input,{failure:{external_effect:'unknown'}})).rejects.toThrow('readback_required');expect(fs.existsSync(path.join(f.root,'recovery-effect'))).toBe(false);}finally{await domain.close();}
}));
test('同进程已导入路径的依赖字节更换必须拒绝，不静默运行旧ESM缓存',()=>withFixture({},async f=>{
 const helper=path.join(f.root,'helper.mjs');fs.writeFileSync(helper,'export const answer=42;');f.profile.files['helper.mjs']=hash('export const answer=42;');
 changeSource(f,s=>"import {answer} from './helper.mjs';\n"+s.replace('live.set(resource,41)','live.set(resource,answer-1)'));
 const {loadWorkflowDomain}=createRequire(import.meta.url)('./workflow-domain.cjs');
 const load=()=>loadWorkflowDomain({profile:f.profile,identity:f.id,runDirectory:path.join(f.root,'run'),controller:new AbortController(),startedAt:Date.now(),recordEvidence:async()=>{}});
 const first=await load();await first.close();
 fs.writeFileSync(helper,'export const answer=43;');f.profile.files['helper.mjs']=hash('export const answer=43;');f.id.profile_sha256=profileDigest(f.profile);
 await expect(load()).rejects.toThrow('source_cache_conflict');await f.r.start(f.id);expect((await terminal(f)).reason).toBe('workflow_domain_source_cache_conflict');expect(fs.readFileSync(path.join(f.root,'factories'),'utf8')).toBe('x');
}));
test('同进程独立validator不能通过修改result把原执行失败升级成功',()=>withFixture({},async f=>{
 changeSource(f,s=>s.replace("status:'completed',outputs:","status:'failed',failure_class:'fatal',outputs:").replace("checkActivity:async(a,result,options)=>({", "checkActivity:async(a,result,options)=>{if(result){result.status='completed';delete result.failure_class;}return ({").replace("evidence:[{independent:true}]}),\n   validateWorkflow:","evidence:[{independent:true}]});},\n   validateWorkflow:"));
 await f.r.start(f.id);expect((await terminal(f)).status).toBe('failed');
}));
test('真实公共Recorder接收domain证据并落本地journal/outbox，不伪造中央ACK',()=>withFixture({useRealRecorder:true},async f=>{
 await f.r.start(f.id);const s=await terminal(f);expect(s.status).toBe('completed');expect(s.writeback.pending).toBeGreaterThan(0);expect(s.writeback.acked).toBe(0);
 const rows=fs.readFileSync(path.join(f.root,'journal','events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 expect(rows.some(row=>row.event?.event?.protocol==='workflow-domain-evidence/v1')).toBe(true);expect(rows.some(row=>row.span?.evidence?.kind==='execution')).toBe(true);
}));
test('真实公共Recorder允许现役Commander重新接回事件并保存原run span',()=>withFixture({},async f=>{
 const {createWorkflowRecorder}=await import('../../src/orchestrator/workflow-recorder.js');
 const recorder=createWorkflowRecorder({root:path.join(f.root,'reconnect-journal'),runId:f.id.run_id,taskId:f.id.task_id,machineId:'fixture',profileDigest:f.id.profile_sha256,mode:'exploration',metadata:f.profile.metadata});
 await expect(recorder.onEvent({cursor:1,event_type:'COMMANDER_RECONNECTED',run_id:f.id.run_id,activity:'work',phase:'event'},{activities:[]})).resolves.toBeUndefined();
 expect(recorder.inspect().spans[0].run_id).toBe(f.id.run_id);expect(recorder.inspect().spans[0].evidence.event.event_type).toBe('COMMANDER_RECONNECTED');
}));
