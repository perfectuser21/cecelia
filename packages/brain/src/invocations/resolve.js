import { compileInvocation } from '../orchestrator/invocation-plan.js';
import { createSkillEnvelope } from '../orchestrator/skill-activity-adapter.js';
import { definitionDigest,object,uuid,requireCondition } from '../workflow-authoring/contracts.js';
import { legacyExecutorEntries } from '../execution-directory/legacy-executor.js';
import { canonicalCandidateTarget,canonicalOwnerTarget } from './candidate-target.js';
import {EXECUTION_PROTOCOL,readCandidateOwner,requireCandidateEnvironment} from '../workflow-authoring/assembly-orchestration.js';

export function validateTargetRequest(body) {
  object(body,'request');object(body.target,'target');object(body.input,'input');
  requireCondition(Buffer.byteLength(JSON.stringify(body))<=200000,'请求过大',413);
  requireCondition(['activity','workflow'].includes(body.target.kind),'目标 kind 无效');
  uuid(body.target.id,'target.id');
  requireCondition(['candidate','released'].includes(body.mode),'调用模式无效');
  if(body.mode==='released')uuid(body.target.definition_version_id,'definition_version_id');
  else {
    uuid(body.authoring_task_id,'authoring_task_id');
    requireCondition(/^[a-f0-9]{64}$/.test(body.compose_sha256??''),'候选必须绑定 compose_sha256');
  }
}
function source(row) {return {repo:row.source_repo,ref:row.source_path,revision:row.source_commit};}
function activityDefinition(row) {
  const contract=row.payload.contract;
  return {key:'single-activity',tenant_id:contract.tenant_id,source:source(row),
    input_schema:contract.input_schema,output_schema:contract.output_schema,
    activities:[{...contract,key:'single'}]};
}
async function loadDefinition(db,body,tenantId) {
  if(body.mode==='candidate'){
    const row=(await db.query('SELECT id,payload,result,status FROM tasks WHERE id=$1',[body.authoring_task_id])).rows[0];
    requireCondition(row&&(row.payload?.tenant_id??'default')===tenantId,'管理任务不存在',404);
    requireCondition(row.payload.workflow_authoring===true&&!['cancelled','failed'].includes(row.status),'管理任务不允许候选调用',409);
    const definition=row.result?.workflow_authoring?.outputs?.compose?.definition;
    requireCondition(definition&&definitionDigest(definition)===body.compose_sha256,'候选组装摘要已变化',409);
    const expected=`candidate:${body.compose_sha256}`;
    requireCondition(!body.target.definition_version_id||body.target.definition_version_id===expected,'候选版本身份不匹配',409);
    const stableId=row.payload.workflow_authoring_request?.workflow_id??row.result?.workflow_authoring?.request?.workflow_id;
    let candidateTrace;
    if(row.result?.workflow_authoring?.request?.execution_protocol===EXECUTION_PROTOCOL){
      await requireCandidateEnvironment(db);
      candidateTrace=await readCandidateOwner(db,row.id,definition,tenantId);
      requireCondition(candidateTrace,'严格候选尚未形成真实冻结owner',409);
    }
    // 新建工作流以管理任务作为候选身份；更新时只能使用该管理任务声明的 workflow。
    const canonical=candidateTrace?canonicalOwnerTarget(body,tenantId,candidateTrace):null;
    if(body.target.kind==='workflow'&&!candidateTrace)requireCondition(body.target.id===(stableId??row.id),'候选目标身份不匹配',409);
    if(body.target.kind==='activity'){
      const target=canonical??canonicalCandidateTarget(body,tenantId);
      const selected=definition.activities?.find(a=>target.slot_key!==undefined?a.key===target.slot_key:
        a.id===target.id||a.activity_id===target.id||a.reuse_activity_id===target.id);
      requireCondition(selected,'候选定义未包含该活动',404);
      return {definition:{...definition,key:'single-activity',input_schema:selected.input_schema,output_schema:selected.output_schema,
        activities:[{...selected,key:selected.key??'single',input_mapping:undefined}],output_mapping:undefined},target,
        candidateTrace:candidateTrace?{...candidateTrace,slots:candidateTrace.slots.filter(s=>s.slot_key===selected.key)}:undefined};
    }
    return {definition,target:canonical??{...body.target,definition_version_id:expected},candidateTrace};
  }
  const kind=body.target.kind,args=[body.target.definition_version_id,body.target.id];
  const row=(kind==='activity'
    ? await db.query('SELECT * FROM activity_definition_versions WHERE id=$1 AND activity_id=$2',args)
    : await db.query('SELECT * FROM workflow_definition_versions WHERE id=$1 AND workflow_id=$2',args)).rows[0];
  requireCondition(row?.payload?.[`${kind}_id`]===body.target.id,'固定目标版本不存在',404);
  requireCondition(row.payload.protocol!=='workflow-assembly-native-v1','系统维护流程仅允许定时调度或内部管理员单轮入口',409);
  const definition=kind==='activity'?activityDefinition(row):{...row.payload.contract,source:source(row)};
  requireCondition((definition.tenant_id??'default')===tenantId,'固定目标版本不存在',404);
  if(kind==='workflow')for(const [index,slot]of definition.activities.entries()){
    const ref=row.payload.activities?.find(a=>a.slot_key===slot.key)||row.payload.activities?.[index];
    requireCondition(ref?.activity_version_id,'流程未冻结活动版本',409);
    definition.activities[index]={...slot,reuse_activity_id:ref.activity_id,reuse_activity_definition_version_id:ref.activity_version_id};
  }
  return {definition,target:body.target};
}
async function catalogFor(db,definition){
  const slots=definition.activities??[];
  const ids=slots.map(s=>s.reuse_activity_definition_version_id).filter(Boolean);ids.forEach(id=>uuid(id,'activity_version_id'));
  const activity_versions=ids.length?(await db.query('SELECT * FROM activity_definition_versions WHERE id=ANY($1::uuid[])',[ids])).rows:[];
  const contracts=[...slots,...activity_versions.map(v=>v.payload.contract)];
  const skillIds=contracts.map(c=>c.implementation?.skill_id).filter(Boolean);skillIds.forEach(id=>uuid(id,'skill_id'));
  const skills=skillIds.length?(await db.query('SELECT id,status FROM skill_registry WHERE id=ANY($1::uuid[])',[skillIds])).rows:[];
  const keys=contracts.flatMap(c=>(c.warehouse_dependencies??[]).map(v=>v.key));
  const warehouse_items=keys.length?(await db.query('SELECT id,key,active,shelf FROM warehouse_items WHERE key=ANY($1::text[])',[keys])).rows:[];
  return {activity_versions,skills,warehouse_items};
}
export async function probeInvocationRuntime({fetchFn=globalThis.fetch,signal,deadline=Date.now()+3000}={}){
  const entries=legacyExecutorEntries().filter(e=>e.executor==='codex');
  const results=await Promise.allSettled(entries.map(async e=>{
    const response=await fetchFn(`${e.url}/health`,{signal:AbortSignal.any([AbortSignal.timeout(Math.max(1,Math.min(3000,deadline-Date.now()))),...(signal?[signal]:[])])});
    requireCondition(response.ok,'执行体离线');const health=await response.json();
    requireCondition(health.ok&&health.status==='healthy'&&health.accounts?.some(a=>!a.tokenExpired&&(a.primaryUsedPct??100)<95),'执行体无可用资源');
    return {machine_id:e.machineId,transport:'codex-bridge'};
  }));
  const live=results.find(r=>r.status==='fulfilled');
  return live?{ready:true,...live.value}:{ready:false,code:'transport_resource_unavailable'};
}
async function releaseFor(db,target,activities){
  const rows=(await db.query(`SELECT r.* FROM release_versions r
    WHERE r.payload->'verification'->>'status'='verified' ORDER BY r.created_at DESC LIMIT 100`)).rows;
  for(const r of rows){
    const list=r.payload[target.kind==='activity'?'activities':'workflows'];
    const matched=list?.some(v=>v.id===target.definition_version_id&&v[`${target.kind}_id`]===target.id)
      &&activities.every(a=>r.payload.components?.some(c=>c.kind==='skill'&&c.repo===a.implementation.repo&&c.path===a.implementation.path&&c.revision===a.implementation.revision&&c.digest===`sha256:${a.skill_sha256}`));
    if(matched&&(await (await import('../lib/release-index.js')).getReleaseGate(db,r.id)).deployed)return r;
  }
  return null;
}
export async function resolveInvocation(db,body,tenantId='default',options={}){
  validateTargetRequest(body);
  const loaded=await loadDefinition(db,body,tenantId);
  const definition=JSON.parse(JSON.stringify(loaded.definition)),target=loaded.target;
  requireCondition((definition.tenant_id??'default')===tenantId,'租户身份不匹配',404);
  const catalog=await catalogFor(db,definition),plan=compileInvocation(definition,catalog,{tenantId,input:body.input});
  let envelope=null,release=null;
  const gaps=[...plan.gaps];
  if(!gaps.some(g=>g.code!=='input_schema_invalid')){
    try {envelope=await createSkillEnvelope({tenant_id:tenantId,target,input:body.input,input_sha256:definitionDigest(body.input),plan,mode:body.mode,authoring_task_id:body.authoring_task_id,compose_sha256:body.compose_sha256,candidateTrace:loaded.candidateTrace},options);}
    catch {gaps.push({code:'implementation_source_unverified'});}
  }
  const runtime=await (options.probeRuntime??probeInvocationRuntime)();
  if(!runtime.ready)gaps.push({code:runtime.code??'runtime_admission_unverified'});
  if(body.mode==='released'&&envelope){
    release=await releaseFor(db,target,envelope.activities);
    if(!release)gaps.push({code:'verified_release_missing'});
    else {envelope.release_id=release.id;const {envelope_sha256:_hash,...raw}=envelope;envelope.envelope_sha256=definitionDigest(raw);}
  }
  return {target,readiness:gaps.length?'blocked':'ready',gaps,input_schema:definition.input_schema??null,
    output_schema:definition.output_schema??null,transport:'codex-bridge',runtime,plan,envelope,release_id:release?.id??null};
}
