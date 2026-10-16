/** 固定 Skill 全文直接进入既有 Codex Bridge prompt，不依赖 skill_override 或本机安装目录。 */
import { createHash } from 'node:crypto';
import { definitionDigest, requireCondition, object } from '../workflow-authoring/contracts.js';
import { validateImplementationBindings } from '../lib/implementation-bindings.js';
import { validateInvocationOutput } from './invocation-plan.js';
export const SKILL_INVOCATION_PROTOCOL='skill-invocation-v1';
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
    output_schema:identity.plan.output_schema,output_mapping:identity.plan.output_mapping,activities,
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
export function invocationPrompt(envelope,taskId,runId){
  assertSkillEnvelope(envelope);
  return [
    '执行本次固定纯 Skill 调用。只使用下方给定 Skill 全文，按 activities 顺序直接在当前进程完成，不派生任务、不调用 /dev、不发布、不发送消息。',
    '严格按 input_mapping 连接 $input 与前序 $activity 输出，按 output_mapping 生成最终 outputs。每一步产物必须符合各自 JSON schema。',
    `身份：${JSON.stringify({task_id:taskId,run_id:runId,tenant_id:envelope.tenant_id,target:envelope.target,input_sha256:envelope.input_sha256})}`,
    '最终仅输出一个 JSON 对象：protocol="skill-invocation-result-v1"，附上上述全部身份字段、activities=[{key,skill_sha256,outputs}]、outputs。失败报告 error，禁止伪造完成。',
    `固定调用快照：\n${JSON.stringify({...envelope,activities:envelope.activities.map(({skill_content:_skillContent,...a})=>a)})}`,
    ...envelope.activities.map(a=>`\nSkill ${a.key}，sha256=${a.skill_sha256}，来源=${a.implementation.repo}@${a.implementation.revision}/${a.implementation.path}\n${a.skill_content}`),
  ].join('\n\n');
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
