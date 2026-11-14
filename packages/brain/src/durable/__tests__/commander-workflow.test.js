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
import {normalizeCommanderRun,decisionRequest,parseCommanderDecision} from '../../orchestrator/commander-decision.js';
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
test('Commander每次决定一个活动，独立检查全部通过后再complete',async()=>{
  const output=await run();expect(output.status).toBe('completed');expect(env.decide).toHaveBeenCalledTimes(3);
  expect(env.executeActivity.mock.calls.map(([a])=>a.key)).toEqual(['a','b']);
  expect(env.decide.mock.calls[0][0].contract.goal).toBe('生成并核验两个产物');expect(env.decide.mock.calls[0][0].input.run_tag).toBe('original');
});
test.each(['complete','skip','stale','unknown-field'])('非法决策%s不启动活动',async kind=>{
  env.decide=vi.fn(async req=>{const d=decision(req);if(kind==='complete'){d.action='complete';delete d.activity_key;}if(kind==='skip')d.activity_key='b';if(kind==='stale')d.sequence++;if(kind==='unknown-field')d.command='anything';return d;});
  expect((await run()).status).toBe('needs_review');expect(env.executeActivity).not.toHaveBeenCalled();expect(env.decide).toHaveBeenCalledTimes(3);
});
test('Commander明确pause不会被代码自动推进',async()=>{env.decide=async req=>{const d=decision(req);delete d.activity_key;return {...d,action:'pause'};};expect((await run()).reason).toBe('commander_paused');expect(env.executeActivity).not.toHaveBeenCalled();});
test('仅纯决策子进程失败允许有限重试',async()=>{env.decide.mockRejectedValueOnce(Error('dead'));expect((await run()).status).toBe('completed');expect(env.decide).toHaveBeenCalledTimes(4);expect(env.executeActivity).toHaveBeenCalledTimes(2);});
test.each([{external_effect:'unknown'},{execution_stopped:false},{adapter_result:{execution_stopped:false}}])('执行安全事实%s不能被completed和checker覆盖',async unsafe=>{
  env.executeActivity=vi.fn(async(_a,input)=>({...result(input),...unsafe}));expect((await run()).status).toBe('needs_review');expect(env.executeActivity).toHaveBeenCalledTimes(1);expect([...records.values()][0].state).toBe('reserved');
});
test('checker缺证据不complete、不进入下一Activity',async()=>{env.checkActivity=async(_a,_r,{phase})=>({verdict:phase==='start'?'pass':'unknown'});expect((await run()).status).toBe('needs_review');expect(env.executeActivity).toHaveBeenCalledTimes(1);});
test('已有意图而读回未知不重新执行，也不结算',async()=>{
  env.actionStore.reserve=async(identity,{deadline_ms})=>({created:false,record:{identity,state:'reserved',deadline_ms}});
  expect((await run()).status).toBe('needs_review');expect(env.executeActivity).not.toHaveBeenCalled();expect(env.inspectActivity).toHaveBeenCalledTimes(1);
});
test('读回必须已停止且输出身份正确',async()=>{
  env.actionStore.reserve=async(identity,{deadline_ms})=>({created:false,record:{identity,state:'reserved',deadline_ms}});
  env.inspectActivity=async(_a,input,{identity})=>({state:'completed',identity,execution_stopped:true,result:{...result(input),run_tag:'wrong'}});
  expect((await run()).status).toBe('needs_review');expect(env.executeActivity).not.toHaveBeenCalled();
});
test('恢复和重复start不能换任务、输入、期限或实现版本',async()=>{
  const original=request();await run(original);
  for(const change of [{input:{run_tag:'changed'}},{deadline_ms:original.deadline_ms+1000},{task_id:'31d3bde2-7e98-4682-8a01-10630880d247'}])await expect(startCommanderWorkflow({...original,...change})).rejects.toThrow('commander_identity_conflict');
  await expect(startCommanderWorkflow({...original,runtime_revision:'b'.repeat(64)})).rejects.toThrow('commander_runtime_revision_mismatch');
  expect(env.executeActivity).toHaveBeenCalledTimes(2);
});
test('原绝对期限已过不询问模型、不执行',async()=>{expect((await run({...request(),deadline_ms:1})).reason).toBe('commander_deadline_exceeded');expect(env.decide).not.toHaveBeenCalled();expect(env.executeActivity).not.toHaveBeenCalled();});
test('实现来源漂移没有执行权',async()=>{env.verifySource=async()=>{throw Error('drift');};expect((await run()).status).toBe('needs_review');expect(env.executeActivity).not.toHaveBeenCalled();});
test('contract unsupported phase 与错摘要在启动前拒绝',()=>{
  const r=request();r.contract.activities[0].runtime.phase='finalize';expect(()=>normalizeCommanderRun(r)).toThrow('commander_activity_unsupported');
  expect(()=>normalizeCommanderRun({...request(),definition_sha256:'0'.repeat(64)})).toThrow('commander_identity_conflict');
  const normalized=normalizeCommanderRun(request()),req=decisionRequest(normalized,[]);expect(()=>parseCommanderDecision({...decision(req),definition_sha256:'wrong'},req)).toThrow('commander_decision_rejected');
});

test('同run的另一action读回不能冒用本次回执',async()=>{
  env.actionStore.reserve=async(identity,{deadline_ms})=>({created:false,record:{identity,state:'reserved',deadline_ms}});
  env.inspectActivity=async(_a,input,{identity})=>({state:'completed',identity:{...identity,activity_key:'other'},execution_stopped:true,result:result(input)});
  expect((await run()).status).toBe('needs_review');expect(env.executeActivity).not.toHaveBeenCalled();
});
