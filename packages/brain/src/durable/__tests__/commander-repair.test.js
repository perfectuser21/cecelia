import {test,expect,beforeEach,vi} from 'vitest';
const sdk = vi.hoisted(() => ({initialized:false,inputs:new Map(),results:new Map()}));
vi.mock('@dbos-inc/dbos-sdk',() => ({DBOS:{
  isInitialized:() => sdk.initialized,registerStep:fn=>fn,registerWorkflow:fn=>fn,
  startWorkflow:(fn,{workflowID})=>async value=>{
    if(!sdk.inputs.has(workflowID)){sdk.inputs.set(workflowID,value);sdk.results.set(workflowID,fn(value));}
    return {getWorkflowInputs:async()=>[sdk.inputs.get(workflowID)],getResult:()=>sdk.results.get(workflowID)};
  },
}}));
import {configureCommanderWorkflow,startCommanderWorkflow} from '../commander-workflow.js';
import {normalizeCommanderRun,actionIdentity} from '../../orchestrator/commander-decision.js';
const activity=(key,order)=>({key,order,budget:{max_duration_s:2,heartbeat_s:1},failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:[]}},runtime:{phase:'source',protocol:'json-stdio-v1',entry:'work.mjs'}});
const request=()=>({schema_version:1,task_id:'1c33723f-611c-4dde-8183-6cbb312101fe',run_id:'2552783f-faf6-431c-b1a0-cb7ebc85c3ba',
  runtime_revision:'a'.repeat(64),deadline_ms:Date.now()+20000,commander_timeout_ms:1000,input:{run_tag:'original'},
  contract:{workflow:'example',goal:'生成并核验两个产物',activities:[activity('a',1),activity('b',2)]}});
const decision=req=>{const {protocol,run_id,definition_sha256,sequence,state_sha256}=req;return {protocol,run_id,definition_sha256,sequence,state_sha256,...req.allowed_actions[0],reason:'根据冻结合同推进'};};
const result=input=>({schema_version:1,run_tag:input.run_tag,status:'completed',outputs:{answer:42},metrics:{},evidence:['product']});
let env, records;
beforeEach(()=>{
  sdk.initialized=false;sdk.inputs.clear();sdk.results.clear();process.env.DBOS_DURABLE_ENABLED='true';records=new Map();
  env={revision:'a'.repeat(64),decide:vi.fn(async req=>decision(req)),verifySource:vi.fn(async()=>{}),
    executeActivity:vi.fn(async(_a,input)=>result(input)),inspectActivity:vi.fn(async()=>({state:'unknown'})),checkActivity:vi.fn(async()=>({verdict:'pass'})),
    actionStore:{reserve:async(id,{deadline_ms})=>{const existing=records.get(id.action_id);if(existing)return {created:false,record:existing};const record={identity:id,state:'reserved',deadline_ms};records.set(id.action_id,record);return {created:true,record};},settle:async(id,value)=>{records.set(id.action_id,{identity:id,state:'settled',result:value,deadline_ms:records.get(id.action_id).deadline_ms});return value;}}};
});
async function run(value=request()){configureCommanderWorkflow(env);sdk.initialized=true;return (await startCommanderWorkflow(value)).handle.getResult();}

const repairRun=()=>{const r=request();r.contract.activities[0].runtime={...r.contract.activities[0].runtime,executor_kind:'agent',checker_repair:{max_attempts:3,retry_safe:true}};return r;};
const feedback=(attempt=1)=>({protocol:'checker-feedback/v1',activity_key:'a',attempt,retryable:true,external_effect:'none',thread_id:'thread-original',evidence_ref:'checks/failure.json',previous_proposal:{answer:0},failed_checks:[{id:'answer',expected:42,actual:0,reason:'答案未达到契约',evidence:[{source:'artifact:answer',observation:{answer:0}}]}]});
const rejection=(input,attempt=1,extra={})=>({...result(input),status:'needs_review',failure_class:'needs_human',outputs:{},execution_stopped:true,reason_code:'skill_check_failed',checker_feedback:feedback(attempt),...extra});
function failThenPass(failures=1){
 env.executeActivity=vi.fn(async(a,input,options)=>a.key==='a'&&(options.identity.attempt??1)<=failures?rejection(input,options.identity.attempt??1):{...result(input),execution_stopped:true});
 env.checkActivity=vi.fn(async(_a,r,{phase})=>({verdict:phase==='end'&&r?.checker_feedback?'fail':'pass'}));
}
test('checker失败完整回传原Activity，下一轮通过才允许下游，action和截止时间按轮绑定',async()=>{
 failThenPass();const out=await run(repairRun());expect(out.status).toBe('completed');
 expect(env.executeActivity.mock.calls.map(([a])=>a.key)).toEqual(['a','a','b']);
 const first=env.executeActivity.mock.calls[0],second=env.executeActivity.mock.calls[1];
 expect(second[1].checker_feedback).toEqual(feedback());expect(second[2].identity.attempt).toBe(2);
 expect(second[2].identity.action_id).not.toBe(first[2].identity.action_id);
 expect(second[2].deadlineMs).toBe(first[2].deadlineMs);
 expect(out.attempt_history.map(r=>r.activity_key)).toEqual(['a','a','b']);
 expect(env.decide.mock.calls[1][0].accepted).toEqual([expect.objectContaining({activity_key:'a',outputs:{answer:42}})]);
 expect(env.executeActivity.mock.calls[2][1].checker_feedback).toBeUndefined();
});
test('三次总执行耗尽只升级一次Commander，失败历史完整且不允许complete或第四次',async()=>{
 failThenPass(9);const out=await run(repairRun());expect(out.status).toBe('needs_review');
 expect(env.executeActivity).toHaveBeenCalledTimes(3);expect(env.decide).toHaveBeenCalledTimes(2);
 const escalation=env.decide.mock.calls[1][0];expect(escalation.sequence).toBe(2);expect(escalation.allowed_actions).toEqual([{action:'pause'}]);
 expect(escalation.accepted).toEqual([]);expect(escalation.failure.attempt_history).toHaveLength(3);
 expect(escalation.failure.checker_feedback.failed_checks[0].actual).toBe(0);
 expect(out.escalation.decision.action).toBe('pause');expect(out.reason).toBe('checker_repair_exhausted');
});
test.each([{external_effect:'unknown'},{execution_stopped:false},{checker_feedback:{...feedback(),retryable:false}},{checker_feedback:{...feedback(),external_effect:'unknown'}}])('不安全失败直接交Commander不返工 %j',async extra=>{
 failThenPass(9);env.executeActivity=vi.fn(async(_a,i)=>rejection(i,1,extra));
 const out=await run(repairRun());expect(out.status).toBe('needs_review');expect(env.executeActivity).toHaveBeenCalledTimes(1);
 expect(env.decide.mock.calls.at(-1)[0].allowed_actions).toEqual([{action:'pause'}]);
});
test('未配置返工仍单次，失败明确报告Commander',async()=>{failThenPass(9);const out=await run();expect(out.status).toBe('needs_review');expect(env.executeActivity).toHaveBeenCalledTimes(1);expect(out.escalation).toBeDefined();});
test('纯Code执行保留输入契约，不注入Agent返工控制字段',async()=>{
 const value=request();value.contract.activities.forEach(a=>{a.runtime.executor_kind='code';});
 expect((await run(value)).status).toBe('completed');
 for(const [,input] of env.executeActivity.mock.calls){expect(input).not.toHaveProperty('execution_attempt');expect(input).not.toHaveProperty('checker_feedback');}
});
test('纯Code既有同名业务字段不被Agent返工机制删除',async()=>{
 const value=request();value.contract.activities.forEach(a=>{a.runtime.executor_kind='code';});
 value.input.execution_attempt=42;value.input.checker_feedback={business:'existing-input'};
 expect((await run(value)).status).toBe('completed');
 expect(env.executeActivity.mock.calls[0][1]).toMatchObject({execution_attempt:42,checker_feedback:{business:'existing-input'}});
});
test('恢复同一run复用每轮已结算动作，不重放任一执行',async()=>{
 failThenPass();const value=repairRun();expect((await run(value)).status).toBe('completed');
 sdk.inputs.clear();sdk.results.clear();sdk.initialized=false;
 expect((await run(value)).status).toBe('completed');expect(env.executeActivity).toHaveBeenCalledTimes(3);
 expect([...records.values()].filter(r=>r.identity.activity_key==='a')).toHaveLength(2);
});
test('第二轮仅有reserved意图但读回未知，不发第三轮或重放第二轮',async()=>{
 failThenPass();const original=env.actionStore.reserve;
 env.actionStore.reserve=async(id,opts)=>id.attempt===2?{created:false,record:{identity:id,state:'reserved',deadline_ms:opts.deadline_ms}}:original(id,opts);
 expect((await run(repairRun())).status).toBe('needs_review');expect(env.executeActivity).toHaveBeenCalledTimes(1);expect(env.inspectActivity).toHaveBeenCalledTimes(1);
});
test.each([{max_attempts:4,retry_safe:true},{max_attempts:3,retry_safe:false},{max_attempts:3,retry_safe:true,unbounded:true},{max_attempts:3,retry_safe:true,effect_scope:'write'}])('冻结返工配置拒绝非法策略 %j',policy=>{
 const r=repairRun();r.contract.activities[0].runtime.checker_repair=policy;expect(()=>normalizeCommanderRun(r)).toThrow('commander_repair_policy_invalid');
});
test('Code和finalizer不能沿用Agent返工策略',()=>{
 const r=repairRun();r.contract.activities[0].runtime.executor_kind='code';expect(()=>normalizeCommanderRun(r)).toThrow('commander_repair_policy_invalid');
});
test('原action身份兼容，返工身份绑定轮数和问题单',()=>{
 const r=normalizeCommanderRun(repairRun()),initial=actionIdentity(r,'a',{}),second=actionIdentity(r,'a',{},2,feedback());
 expect(initial.attempt).toBeUndefined();expect(second.attempt).toBe(2);expect(second.action_id).not.toBe(initial.action_id);
 expect(actionIdentity(r,'a',{},2,{...feedback(),thread_id:'other'}).input_sha256).not.toBe(second.input_sha256);
});
