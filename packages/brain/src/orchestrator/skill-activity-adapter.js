/** 固定 Skill 全文直接进入既有 Codex Bridge prompt，不依赖 skill_override 或本机安装目录。 */
import { createHash } from 'node:crypto';
import { definitionDigest, requireCondition, object } from '../workflow-authoring/contracts.js';
import { validateImplementationBindings } from '../lib/implementation-bindings.js';
import { validateInvocationOutput } from './invocation-plan.js';
import {runActivityContract} from './activity-runtime.js';
import {createCommanderBridge} from './runner-commander-bridge.js';
import {trustedCommanderTransport} from './activity-supervision.js';
export const SKILL_INVOCATION_PROTOCOL='skill-invocation-v1';
export const INVOCATION_RUNNER_POLICY={protocol:'skill-invocation-runner-v1',budget:{max_duration_s:300,heartbeat_s:5},on_status:{done:'next',empty:'pause',retry:'pause',failed:'pause',partial:'pause',needs_review:'pause'}};
export async function createSkillEnvelope(identity,{readFile=async source=>(await import('../workflow-authoring/fixed-git-source.js')).readFixedGitFile(source)}={}) {
  const activities=[];let size=0;
  for(const activity of identity.plan.activities){
    const impl=activity.implementation;
    requireCondition(impl?.kind==='skill','只支持固定 Skill 实现');
    const content=await readFile({repo:impl.repo,path:impl.path,revision:impl.revision});
    size+=Buffer.byteLength(content);requireCondition(size<=512*1024,'Skill 全文总量超过限制',413);
    const bindings=await validateImplementationBindings({implementation:impl},async()=>content,{repo:impl.repo,commit:impl.revision});
    requireCondition(bindings.length===1&&bindings[0].status==='verified','Skill 来源无法核验');
    activities.push({...activity,skill_content:content,skill_sha256:createHash('sha256').update(content).digest('hex'),skill_name:bindings[0].name,skill_version:bindings[0].version});
  }
  const envelope={protocol:SKILL_INVOCATION_PROTOCOL,tenant_id:identity.tenant_id,target:identity.target,
    input:identity.input,input_sha256:identity.input_sha256,definition_sha256:identity.plan.definition_sha256??null,
    output_schema:identity.plan.output_schema,output_mapping:identity.plan.output_mapping,activities,runner_policy:structuredClone(INVOCATION_RUNNER_POLICY),
    mode:identity.mode??'candidate',authoring_task_id:identity.authoring_task_id??null,compose_sha256:identity.compose_sha256??null,
    release_id:identity.release_id??null,...(identity.candidateTrace?{candidate_trace:identity.candidateTrace}:{})};
  return {...envelope,envelope_sha256:definitionDigest(envelope)};
}
export function assertSkillEnvelope(envelope){
  requireCondition(envelope?.protocol===SKILL_INVOCATION_PROTOCOL,'未知调用协议');
  const {envelope_sha256,...body}=envelope;
  requireCondition(definitionDigest(body)===envelope_sha256,'调用快照摘要不符');
  requireCondition(definitionDigest(envelope.input)===envelope.input_sha256,'输入摘要不符');
  for(const a of envelope.activities)requireCondition(createHash('sha256').update(a.skill_content).digest('hex')===a.skill_sha256,'Skill 字节摘要不符');
}
export function invocationPrompt(envelope){
  assertSkillEnvelope(envelope);
  throw new Error('整包Skill提示词已停用，必须经公共Runner逐Activity执行');
}
function mapped(path,input,activities){
  const fromInput=path.match(/^\$input\.([\w]+)$/);if(fromInput)return input[fromInput[1]];
  const fromActivity=path.match(/^\$activity\.(.+)\.([\w]+)$/);
  requireCondition(fromActivity&&Object.hasOwn(activities,fromActivity[1]),'产物映射缺失');
  return activities[fromActivity[1]][fromActivity[2]];
}
export function validateSkillReceipt(envelope,value,taskId,runId){
  assertSkillEnvelope(envelope);
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{throw new Error('产物必须是完整JSON');}}
  // Bridge 把 final text 包在 result 字段；不从混杂 prose 猜测 JSON。
  if(value?.protocol!=='skill-invocation-result-v1'&&typeof value?.result==='string')return validateSkillReceipt(envelope,value.result,taskId,runId);
  object(value,'receipt');
  requireCondition(value.protocol==='skill-invocation-result-v1'&&value.task_id===taskId&&value.run_id===runId&&runId
    &&value.tenant_id===envelope.tenant_id&&value.input_sha256===envelope.input_sha256
    &&definitionDigest(value.target)===definitionDigest(envelope.target),'产物身份不匹配');
  requireCondition(Array.isArray(value.activities)&&value.activities.length===envelope.activities.length,'活动产物数量不匹配');
  const outputs=Object.create(null);
  for(const [index,a] of envelope.activities.entries()){
    const receipt=value.activities[index];
    requireCondition(receipt?.key===a.key&&receipt.skill_sha256===a.skill_sha256,'活动或 Skill 摘要不匹配');
    const input=Object.fromEntries(Object.entries(a.input_mapping).map(([key,path])=>[key,mapped(path,envelope.input,outputs)]));
    validateInvocationOutput(a.input_schema,input);validateInvocationOutput(a.output_schema,receipt.outputs);
    outputs[a.key]=receipt.outputs;
  }
  const expected=Object.fromEntries(Object.entries(envelope.output_mapping).map(([key,path])=>[key,mapped(path,envelope.input,outputs)]));
  validateInvocationOutput(envelope.output_schema,value.outputs);
  requireCondition(definitionDigest(expected)===definitionDigest(value.outputs),'最终输出与活动映射不一致');
  return value;
}

/** 只给执行者一个固定Activity；没有后续活动或改路由的能力。 */
export function activityInvocationPrompt(request){
 return ['只执行下方单个固定Skill合同。禁止派生任务、/dev、写文件、发布、发送消息或其他外部写入；不得决定工作流顺序或通过与否。',
  '只返回完整JSON：protocol="skill-activity-result-v1"、identity中的全部字段、outputs（符合output_schema）。失败如实返回error。',
  `固定Skill sha256=${request.skill.sha256}：\n${request.skill.content}`,JSON.stringify(request)].join('\n\n');
}
export async function runSkillInvocation(envelope,taskId,runId,{executeSkill,validator,onEvent=async()=>{},commander,signal}={}){
 assertSkillEnvelope(envelope);
 const reviewed=reason=>({runtime:{status:'needs_review',reason_code:reason,activities:[]},receipt:null});
 if(!envelope.runner_policy||definitionDigest(envelope.runner_policy)!==definitionDigest(INVOCATION_RUNNER_POLICY))return reviewed('runner_policy_missing');
 if(!envelope.activities?.length||envelope.activities.some(a=>!a.activity_contract?.acceptance?.length
  ||!a.activity_contract.input_schema||!a.activity_contract.output_schema
  ||!['none','read_only'].includes(a.activity_contract.mutation_intent)))return reviewed('activity_contract_missing');
 if(new Set(envelope.activities.map(a=>a.key)).size!==envelope.activities.length)return reviewed('activity_identity_duplicate');
 if(envelope.activities.some(a=>Object.keys(a.activity_contract.resources??{}).length||(a.warehouse_dependencies??[]).length
  ||a.implementation?.kind!=='skill'||definitionDigest(a.input_schema)!==definitionDigest(a.activity_contract.input_schema)
  ||definitionDigest(a.output_schema)!==definitionDigest(a.activity_contract.output_schema)))return reviewed('activity_contract_unconfirmed');
 const aliases=Object.fromEntries(envelope.activities.map((a,i)=>[a.key,`slot_${i+1}`]));
 const sources=Object.fromEntries(envelope.activities.map(a=>[aliases[a.key],a]));
 const emit=event=>onEvent({...event,...(sources[event.activity]?{activity:sources[event.activity].key,runtime_activity:event.activity}:{}),task_id:taskId,run_id:runId,tenant_id:envelope.tenant_id,input_sha256:envelope.input_sha256,envelope_sha256:envelope.envelope_sha256});
 if(!commander){let transport;try{transport=trustedCommanderTransport();}catch{}
  commander=createCommanderBridge({run_id:runId,transport,onEvent:emit,brief:{purpose:'执行固定Skill调用',target:envelope.target,activities:envelope.activities.map(a=>({key:aliases[a.key],activity:a.key,contract:a.activity_contract}))},rules:['固定来源与输入摘要','只读外部效果','独立schema与质量验收']});}
 const contract={workflow:'skill-invocation',on_status:envelope.runner_policy.on_status,activities:envelope.activities.map((a,i)=>({key:aliases[a.key],order:i+1,
  budget:envelope.runner_policy.budget,failure:{empty_ok:[],retryable:[],fatal:[],needs_human:{cases:['unconfirmed']}},
  runtime:{protocol:'json-stdio-v1',phase:'source',entry:'skill-invocation.mjs',executor_kind:'agent',max_attempts:1,retry_safe:false,recovery_safe:true}}))};
 const execute=async(a,input,opts)=>{
  const source=sources[a.key],identity={task_id:taskId,run_id:runId,tenant_id:envelope.tenant_id,target:envelope.target,input_sha256:envelope.input_sha256,envelope_sha256:envelope.envelope_sha256,activity:source.key,skill_sha256:source.skill_sha256,slot_input_sha256:definitionDigest(input.activity_input),attempt:input.attempt};
  const request={identity,input:input.activity_input,input_schema:source.input_schema,output_schema:source.output_schema,contract:source.activity_contract,
   skill:{content:source.skill_content,sha256:source.skill_sha256,implementation:source.implementation},guidance:input.commander_guidance??[],recovery_mode:input.recovery_mode??null};
  const raw=await executeSkill(request,{...opts,budget:a.budget});
  let value=raw;if(typeof raw==='string')value=JSON.parse(raw);
  if(value?.protocol!=='skill-activity-result-v1'&&typeof value?.result==='string')value=JSON.parse(value.result);
  requireCondition(value?.protocol==='skill-activity-result-v1'&&Object.entries(identity).every(([key,v])=>definitionDigest(value[key])===definitionDigest(v)),'单Activity回执身份不匹配');
  return {schema_version:1,run_tag:runId,status:value.external_effect==='unknown'?'needs_review':'completed',
   ...(value.external_effect==='unknown'?{external_effect:'unknown',failure_class:'needs_human'}:{}),
   ...(value.execution_stopped===false?{execution_stopped:false}:{}),
   outputs:{[a.key]:value.outputs},metrics:{},evidence:[{activity:source.key,skill_sha256:source.skill_sha256}],adapter_result:value};
 };
 let runtime;
 try{
  await commander.wake?.();
  runtime=await runActivityContract(contract,{run_tag:runId},{signal,commander,onEvent:emit,
   prepareInput:async(a,input)=>{const source=sources[a.key],previous=Object.fromEntries(Object.entries(aliases).filter(([,alias])=>Object.hasOwn(input,alias)).map(([key,alias])=>[key,input[alias]]));
    return {...input,activity_input:Object.fromEntries(Object.entries(source.input_mapping).map(([key,path])=>[key,mapped(path,envelope.input,previous)]))};},
   executeActivity:execute,recoverActivity:execute,
   checkActivity:async(a,result,{phase,input,signal:checkSignal})=>{
    const source=sources[a.key];
    if(phase==='start'){validateInvocationOutput(source.input_schema,input.activity_input);return {verdict:'pass',checks:[{mode:'hard',pass:true}]};}
    validateInvocationOutput(source.output_schema,result.outputs[a.key]);
    // schema明确只需结构时可代码验收；其他文字标准必须由独立validator提供证据。
    if(source.activity_contract.validation?.kind==='schema')return {verdict:'pass',checks:[{mode:'hard',pass:true}],evidence:['schema']};
    if(!validator)return {verdict:'unknown',reason:'independent_validator_missing',checks:[{mode:'hard',pass:true}]};
    const verdict=await validator({activity:source.key,contract:source.activity_contract,input:input.activity_input,outputs:result.outputs[a.key],identity:{task_id:taskId,run_id:runId,tenant_id:envelope.tenant_id,envelope_sha256:envelope.envelope_sha256}},{signal:checkSignal});
    return verdict?.verdict==='pass'&&(!Array.isArray(verdict.evidence)||!verdict.evidence.length)?{verdict:'unknown',reason:'validator_evidence_missing'}:verdict;
   }});
 }finally{await commander.sleep?.();}
 runtime.activities=runtime.activities.map(record=>{const source=sources[record.key];return {...record,key:source?.key??record.key,runtime_key:record.key,
  ...(source?{skill_sha256:source.skill_sha256,source:source.implementation,activity_contract_sha256:definitionDigest(source.activity_contract)}:{})};});
 if(runtime.status!=='completed')return {runtime,receipt:null};
 const outputsByKey=Object.fromEntries(envelope.activities.map(a=>[a.key,runtime.outputs[aliases[a.key]]]));
 const receipt={protocol:'skill-invocation-result-v1',task_id:taskId,run_id:runId,tenant_id:envelope.tenant_id,target:envelope.target,input_sha256:envelope.input_sha256,
  activities:envelope.activities.map(a=>({key:a.key,skill_sha256:a.skill_sha256,outputs:outputsByKey[a.key]})),outputs:Object.fromEntries(Object.entries(envelope.output_mapping).map(([key,path])=>[key,mapped(path,envelope.input,outputsByKey)]))};
 validateSkillReceipt(envelope,receipt,taskId,runId);
 return {runtime,receipt};
}
