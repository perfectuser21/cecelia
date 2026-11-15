import {it,expect} from 'vitest';
import {validateDefinition,validateReferences} from '../workflow-authoring/registration.js';
import {authoringMutationError} from '../workflow-authoring/task-guard.js';
const id='11111111-1111-4111-8111-111111111111';
export const runtime=()=>({kind:'commander-foundation-v1',profile_ref:{repo:'example/workflows',path:'workflows/report/profile.json',revision:'a'.repeat(40),digest:'sha256:'+'b'.repeat(64)},timeout_ms:60000,input_schema:{type:'object',properties:{value:{type:'integer'}},required:['value'],additionalProperties:false}});
const definition=()=>({key:'example_report',name:'报告',capability_id:id,channel:'internal',form:'pipeline',version:'1.0.0',source:{ref:'workflows/report/definition.json',revision:'a'.repeat(40)},runtime:runtime(),activities:[{key:'report',name:'生成报告',executor_kind:'code',acceptance:['真实报告与输入一致'],implementation:{kind:'code',ref:'workflows/report/run.mjs',version:'1.0.0'}}]});
it('新底座定义不强制伪造OpenClaw skill_id，仍通过真实登记校验',async()=>{
 expect(validateDefinition(definition())).toBe(true);
 const queries=[];const db={query:async(sql)=>{queries.push(sql);if(sql.includes('FROM capabilities'))return {rows:[{id,parent_journey_id:id,status:'active'}]};if(sql.includes('FROM skill_registry'))return {rows:[]};throw Error(sql);}};
 expect(await validateReferences(db,definition(),{requireActive:true})).toBe(true);
});
it('普通任务PATCH不可把foundation任务写为成功或改运行绑定',()=>{
 expect(authoringMutationError({payload:{commander_protocol:'commander-foundation-v1'}},{status:'completed'})).toMatchObject({code:'FOUNDATION_CONTROL_OWNED'});
 expect(authoringMutationError({}, {result:{foundation_runner:{status:'completed'}}})).toMatchObject({code:'FOUNDATION_CONTROL_RESERVED'});
});

import {validateFoundationRuntime,validateFoundationInput,byteHash,parseFoundationProfile,preparedFoundationRun} from './contracts.js';
import {verifyFoundationObservation} from './reconcile.js';
import {buildTerminalUpdate} from '../lib/task-terminal.js';
const activity=()=>({key:'report',order:1,budget:{max_duration_s:10,heartbeat_s:1},acceptance:{description:'结果为42'},failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:['unknown']}},runtime:{phase:'source',protocol:'json-stdio-v1',entry:'work.mjs',argv:[],executor_kind:'code'}});
function profileFixture(){
 const doc={schema_version:1,contract:{workflow:'example_report',activities:[activity()]},profile:{adapter:'adapter.mjs',files:{'adapter.mjs':'c'.repeat(64),'work.mjs':'d'.repeat(64)}}};
 const text=JSON.stringify(doc),r=runtime();r.profile_ref.digest='sha256:'+byteHash(text);
 return {doc,text,r,release:{payload:{components:[{kind:'code',...r.profile_ref},...Object.entries(doc.profile.files).map(([path,hash])=>({kind:'code',...r.profile_ref,path,digest:'sha256:'+hash}))]}},workflow:{payload:{contract:{key:'example_report'},activities:[{slot_key:'report'}]}}};
}
it('拒绝浮动版本、目录穿越、非法预算和异步远程schema',()=>{
 for(const change of [r=>r.profile_ref.revision='main',r=>r.profile_ref.path='../profile.json',r=>r.timeout_ms=Infinity,r=>r.input_schema.$async=true,r=>r.input_schema.$ref='https://example.invalid/schema']){const r=runtime();change(r);expect(()=>validateFoundationRuntime(r)).toThrow();}
});
it('输入遵从冻结schema且不能覆盖原run身份',()=>{
 expect(validateFoundationInput(runtime(),{value:42})).toEqual({value:42});
 for(const input of [{value:'42'},{value:42,extra:1},{value:42,run_tag:id},{}])expect(()=>validateFoundationInput(runtime(),input)).toThrow();
});
it('profile精确字节及每份依赖必须进入release组件',()=>{
 const f=profileFixture();expect(parseFoundationProfile(f.text,f.r,f.release,f.workflow).contract.activities).toHaveLength(1);
 expect(()=>parseFoundationProfile(f.text+' ',f.r,f.release,f.workflow)).toThrow('foundation_profile_digest_mismatch');
 f.release.payload.components.pop();expect(()=>parseFoundationProfile(f.text,f.r,f.release,f.workflow)).toThrow('foundation_dependency_unbound');
});
it('固定profile不能注入宿主路径或缩减冻结活动集合',()=>{
 const f=profileFixture();f.doc.profile.cwd='/tmp';f.text=JSON.stringify(f.doc);f.r.profile_ref.digest='sha256:'+byteHash(f.text);
 expect(()=>parseFoundationProfile(f.text,f.r,f.release,f.workflow)).toThrow('foundation_profile_invalid');
 const g=profileFixture();g.workflow.payload.activities.push({slot_key:'missing'});expect(()=>parseFoundationProfile(g.text,g.r,g.release,g.workflow)).toThrow('foundation_activity_binding_mismatch');
});
function observationFixture(){
 const f=profileFixture();const job={task_id:id,run_id:'22222222-2222-4222-8222-222222222222',runtime:f.r,input:{value:42,run_tag:'22222222-2222-4222-8222-222222222222'},deadline_ms:Date.now()+60000};job.run=preparedFoundationRun(job,f.doc.contract,'e'.repeat(64));
 return {job,observed:{workflowID:`commander-foundation:${job.run_id}`,applicationVersion:job.run.runtime_revision,status:'SUCCESS',input:[job.run],output:{task_id:id,run_id:job.run_id,status:'completed',business_pass:true,receipts:[{scope:'activity',activity_key:'report',activities:[{key:'report',validator_verdict:{verdict:'pass'},attempts:[{status:'completed',external_effect:'none',execution_stopped:true}]}]}]}}};
}
it('仅接受DBOS原run原runtime及独立checker通过的成功结果',()=>{
 const {job,observed}=observationFixture();expect(verifyFoundationObservation(job,observed).status).toBe('completed');
 expect(()=>verifyFoundationObservation(job,{...observed,applicationVersion:'f'.repeat(64)})).toThrow('foundation_dbos_identity_conflict');
 const bad=structuredClone(observed);bad.output.receipts[0].activities[0].validator_verdict.verdict='fail';expect(()=>verifyFoundationObservation(job,bad)).toThrow('foundation_result_unverified');
 expect(verifyFoundationObservation(job,{...observed,status:'PENDING'})).toBeNull();
});
it('DBOS真实恢复耗尽终态进入blocked，不永久挂in_progress',()=>{
 const {job,observed}=observationFixture();expect(verifyFoundationObservation(job,{...observed,status:'MAX_RECOVERY_ATTEMPTS_EXCEEDED'})).toMatchObject({status:'blocked',reason:'foundation_dbos_execution_unknown'});
});
it('普通终态出口不得绕过foundation，专用出口同时核验task_run与DBOS绑定',()=>{
 expect(buildTerminalUpdate(id,'completed').sql).toContain("IS DISTINCT FROM 'commander-foundation-v1'");
 const proof={runId:id,status:'completed',definitionSha256:'e'.repeat(64)};
 const sql=buildTerminalUpdate(id,'completed',{foundationReconciliation:proof}).sql;
 expect(sql).toContain("fr.context->>'source'='commander-foundation'");expect(sql).toContain("{foundation_reconciliation,dbos_status}'='SUCCESS'");
 expect(()=>buildTerminalUpdate(id,'completed',{foundationReconciliation:{...proof,mode:'preflight'}})).toThrow('foundation_terminal_proof_invalid');
});
it('DBOS成功也不能缺活动、重复receipt或带未知副作用',()=>{
 const {job,observed}=observationFixture();
 const extra=structuredClone(activity());extra.key='second';extra.order=2;job.run=preparedFoundationRun(job,{workflow:'example_report',activities:[activity(),extra]},'e'.repeat(64));observed.input=[job.run];
 expect(()=>verifyFoundationObservation(job,observed)).toThrow('foundation_result_unverified');
 observed.output.receipts.push(structuredClone(observed.output.receipts[0]));expect(()=>verifyFoundationObservation(job,observed)).toThrow('foundation_result_unverified');
 const f=observationFixture();f.observed.output.receipts[0].activities[0].attempts=[{status:'completed',external_effect:'unknown'}];expect(()=>verifyFoundationObservation(f.job,f.observed)).toThrow('foundation_result_unverified');
});
it('冻结合同显式stop可省略后续source，但必须完成finalize',()=>{
 const {job,observed}=observationFixture();const first=activity();first.runtime.on_status={done:'stop',needs_review:'pause'};
 const skipped={...activity(),key:'skipped',order:2},cleanup={...activity(),key:'cleanup',order:3,runtime:{...activity().runtime,phase:'finalize'}};
 job.cleanup_deadline_ms=job.deadline_ms+10000;job.run=preparedFoundationRun(job,{workflow:'example_report',activities:[first,skipped,cleanup]},'e'.repeat(64));observed.input=[job.run];
 expect(()=>verifyFoundationObservation(job,observed)).toThrow('foundation_result_unverified');
 const receipt=structuredClone(observed.output.receipts[0]);receipt.activity_key='cleanup';receipt.activities[0].key='cleanup';observed.output.receipts.push(receipt);observed.output.cleanup_status='completed';
 expect(verifyFoundationObservation(job,observed).status).toBe('completed');
});
