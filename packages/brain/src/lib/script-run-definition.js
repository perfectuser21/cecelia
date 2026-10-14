/** script_run 的正式定义起跑门；定义、发布观测及绑定都复用现有协议。 */
import path from 'node:path';
import {resolveMachineId} from '../machine-registry.js';
import {validateScriptPayload} from './script-task-spec.js';
import {PATROL_CAPABILITY,PATROL_REPO} from './device-patrol-admission.js';
import {FREEZE_PROTOCOL} from '../workflow-authoring/freeze.js';
import {evidenceHash,getReleaseGate} from './release-index.js';
import {getRunDefinitionBinding} from './run-definition-binding.js';
import {startRun} from './task-run.js';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{40}$/;
// 现有巡查能力及正式稳定key；不把admission来源历史当执行定义。
const PATROL_KEYS=new Set(['single-phone-account-patrol','phone-account-patrol-batch','phone-account-patrol-maintenance']);
const fail=message=>{throw Object.assign(Error(message),{code:'script_definition_unverified'});};
const requireValue=(value,message)=>{if(!value)fail(message);};
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
const machine=host=>resolveMachineId(host)||host;
function templateCommand(template,payload){
  requireValue(typeof template==='string'&&template.length<=8192,'固定脚本命令模板缺失或过长');
  let applicable=true;
  const rendered=template.replace(/\{\{([^{}]+)\}\}/g,(_,key)=>{
    requireValue(['phone_serial','recovery_demand_id'].includes(key),'固定模板含未知参数');
    const value=payload[key];
    if(value===undefined){applicable=false;return '';}
    requireValue((key==='phone_serial'&&typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value))
      ||(key==='recovery_demand_id'&&typeof value==='string'&&UUID.test(value)),'固定脚本模板参数不可确认');
    return value;
  });
  return applicable?rendered:null;
}
function expectedPath(workflow,activities){
  return workflow.payload.activities.flatMap(ref=>{
    const activity=activities.find(a=>a.id===ref.activity_version_id&&a.activity_id===ref.activity_id);
    requireValue(activity?.payload.registration_protocol===FREEZE_PROTOCOL&&!activity.payload.definition_scope,'缺完整可执行Activity冻结版本');
    requireValue(activity.payload.steps?.length&&activity.payload.steps.every(s=>UUID.test(s.step_id||'')),'固定Activity缺规范Step身份');
    const base={reference_id:ref.reference_id,activity_id:ref.activity_id,activity_definition_version_id:ref.activity_version_id,required:true};
    return [base,...activity.payload.steps.map(s=>({...base,step_id:s.step_id}))];
  });
}
export function scriptRuntimeIdentity(task,spec,release,workflow,activities,runId,patrol){
  requireValue(workflow?.payload.registration_protocol===FREEZE_PROTOCOL&&!workflow.payload.definition_scope,'不是正式freeze-v1执行定义');
  const contract=workflow.payload.contract,script=contract?.runtime?.script;
  requireValue(script&&machine(script.host)===spec.host&&script.cwd===spec.cwd&&same(script.env,spec.env),'脚本host/cwd/env与固定定义不符');
  requireValue(Array.isArray(script.commands)&&script.commands.length>0&&script.commands.length<=20,'缺固定脚本命令');
  requireValue(script.commands.some(command=>templateCommand(command,task.payload)===spec.cmd),'实际命令未命中固定脚本入口');
  const split=release.target.indexOf(':'),targetHost=release.target.slice(0,split),targetPath=release.target.slice(split+1);
  requireValue(split>0&&machine(targetHost)===spec.host&&path.posix.isAbsolute(targetPath)&&path.posix.normalize(targetPath)===targetPath,'release目标不是实际宿主固定目录');
  const sources=task.payload;
  requireValue(SHA.test(sources.source_revision||''),'任务缺固定执行源码');
  const bindings=activities.flatMap(a=>a.payload.implementation_bindings||[]);
  requireValue(bindings.length>0&&bindings.every(b=>b.status==='verified'&&['code','skill'].includes(b.kind)
    &&release.payload.components.some(c=>c.kind===b.kind&&c.repo===b.repo&&c.revision===b.revision&&c.path===b.path&&c.digest===b.digest)),'实现未被完整已部署组件覆盖');
  // 精确命令已匹配冻结模板；这里独立核对真正执行文件与其固定Code版本。
  const tokens=spec.cmd.split(/\s+/),interpreter=/\/(?:python3|node|bash|sh)$/.test(tokens[0])||['python3','node','bash','sh'].includes(tokens[0]);
  const entry=interpreter?tokens[1]:tokens[0];
  const controlEntry=typeof entry==='string'&&entry.includes('/infra-workflow-commander/');
  const control=controlEntry?(sources.control_source_revision??sources.source_revision):sources.control_source_revision;
  const revision=controlEntry?control:sources.source_revision;
  const phone=sources.phone_source_revision??sources.original_scope?.phone_source_revision??(patrol?sources.source_revision:undefined);
  requireValue(typeof entry==='string'&&path.posix.isAbsolute(entry)&&bindings.some(b=>b.kind==='code'&&b.revision===revision
    &&(entry.endsWith('/'+b.path)||path.posix.basename(entry)===path.posix.basename(b.path))
    &&(!patrol||b.repo===PATROL_REPO&&entry.includes('/releases/'+revision+'/'))),'执行入口与任务源码及已核验Code不符');
  for(const [field,actual] of Object.entries({source_revision:sources.source_revision,phone_source_revision:phone,control_source_revision:control})){
    const schema=contract.input_schema?.properties?.[field];
    const required=patrol&&field!=='control_source_revision'||contract.input_schema?.required?.includes(field);
    if(actual===undefined&&!required)continue;
    if(!schema&&!patrol)continue;
    const allowed=schema&&Object.hasOwn(schema,'const')?[schema.const]:schema?.enum;
    requireValue(Array.isArray(allowed)&&allowed.length>0&&allowed.length<=20&&allowed.every(v=>SHA.test(v))&&allowed.includes(actual),'执行来源不满足固定输入const/enum：'+field);
  }
  if(patrol){
    if(sources.original_scope?.phone_source_revision!==undefined)requireValue(phone===sources.original_scope.phone_source_revision,'恢复原始手机源码不可改变');
    requireValue(SHA.test(phone)&&targetPath.endsWith('/phone-account-patrol/releases/'+phone),'手机源码与真实并存安装目标不符');
    for(const source of [phone,control].filter(v=>v!==undefined)){
      requireValue(SHA.test(source)&&bindings.some(b=>b.kind==='code'&&b.repo===PATROL_REPO&&b.revision===source),'手机或控制源码不属于固定实现');
    }
    if(controlEntry&&sources.control_source_revision!==undefined)requireValue(sources.control_source_revision===revision,'控制入口与控制源码不符');
  }else requireValue(entry.startsWith(targetPath+'/'),'脚本入口不在已观测部署目标内');
  return {entry_source_revision:revision,phone_source_revision:phone,control_source_revision:control,
    runtime_snapshot_sha256:evidenceHash({task_id:task.id,run_id:runId,workflow_id:workflow.workflow_id,definition_version_id:workflow.id,
      release_id:release.id,manifest_sha256:release.manifest_sha256,target:release.target,spec,
      sources:{source_revision:sources.source_revision,phone_source_revision:phone??null,control_source_revision:control??null,phone_serial:sources.phone_serial??null}})};
}
function validateDeclaration(explicit,definition){
  if(!explicit)return;
  const allowed=['release_id','observation_id','workflow_id','workflow_definition_version_id','snapshot_sha256','runtime_snapshot_sha256','expected_path','attempt_key','actor'];
  requireValue(typeof explicit==='object'&&!Array.isArray(explicit)&&Object.keys(explicit).every(k=>allowed.includes(k)),'显式固定定义含未知字段');
  requireValue(['release_id','workflow_definition_version_id','snapshot_sha256'].every(k=>explicit[k]===definition[k]),'显式固定定义身份不匹配');
  for(const key of allowed)if(explicit[key]!==undefined)requireValue(same(explicit[key],definition[key]),'显式声明与真实冻结身份不符');
}
function runContext(task,workflow,context,identity){
  const p=task.payload;
  return {...context,task_type:task.task_type,workflow_snapshot:{workflow_id:workflow.workflow_id,workflow_version:workflow.payload.contract.version,
    definition_version_id:workflow.id,definition_source_revision:workflow.source_commit,source_revision:p.source_revision,control_source_revision:identity.control_source_revision,
    entry_source_revision:identity.entry_source_revision,phone_source_revision:identity.phone_source_revision,phone_serial:p.phone_serial,batch_task_id:p.batch_task_id??p.original_scope?.origin_batch_task_id,
    attempt:(p.script_attempts?.length??0)+1}};
}
export async function startScriptDefinitionRun({task,spec,runId,context},pool){
  const initial=task.payload??{};
  if(!initial.workflow_id&&!initial.workflow_definition)return null;
  requireValue(UUID.test(initial.workflow_id||''),'任务Workflow身份无效');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const fresh=(await client.query('SELECT * FROM tasks WHERE id=$1 FOR NO KEY UPDATE',[task.id])).rows[0];
    requireValue(fresh&&['queued','in_progress'].includes(fresh.status),'任务已终结或不可起跑');
    requireValue(same(validateScriptPayload(fresh.payload),spec)&&fresh.payload.workflow_id===initial.workflow_id,'起跑前任务脚本范围已变化');
    task=fresh;
    const workflow=(await client.query('SELECT * FROM workflows WHERE id=$1',[initial.workflow_id])).rows[0];
    const patrol=workflow?.capability_id===PATROL_CAPABILITY&&PATROL_KEYS.has(workflow.key);
    const explicit=task.payload.workflow_definition;
    const current=workflow?.current_definition_version_id&&(await client.query('SELECT payload FROM workflow_definition_versions WHERE id=$1',[workflow.current_definition_version_id])).rows[0];
    if(!patrol&&!explicit&&current?.payload.registration_protocol!==FREEZE_PROTOCOL){
      const exists=(await client.query("SELECT to_regclass('run_definition_bindings') AS name")).rows[0]?.name;
      const bound=exists&&(await client.query('SELECT 1 FROM run_definition_bindings WHERE run_id=$1',[runId])).rows.length>0;
      if(!bound){await client.query('COMMIT');return null;}
    }
    requireValue(workflow,'正式Workflow不存在');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,515))',[runId]);
    const prior=(await client.query('SELECT * FROM task_runs WHERE run_id=$1',[runId])).rows[0];
    if(prior){
      requireValue(prior.task_id===task.id&&prior.workflow_id===workflow.id&&prior.status==='running'&&!prior.ended_at,'同Run已结束或属于其他任务');
      const fixed=await getRunDefinitionBinding(client,runId);
      requireValue(fixed,'历史未绑定Run不可事后补挂当前定义');
      const identity=scriptRuntimeIdentity(task,spec,fixed.release,fixed.workflow,fixed.activities,runId,patrol);
      requireValue(fixed.binding.payload.runtime_snapshot_sha256===identity.runtime_snapshot_sha256,'同Run的执行脚本或来源已改变');
      validateDeclaration(explicit,fixed.binding.payload);
      requireValue((await getReleaseGate(client,fixed.release.id)).deployed,'原固定安装已漂移');
      await client.query('COMMIT');return {id:prior.id,run_id:runId,binding:fixed.binding,created:false};
    }
    if(explicit)requireValue(typeof explicit==='object'&&!Array.isArray(explicit)&&UUID.test(explicit.release_id||'')&&UUID.test(explicit.workflow_definition_version_id||''),'显式固定定义身份不完整');
    const releases=(await client.query(`SELECT * FROM release_versions WHERE payload->'workflows' @> $1::jsonb
      ${explicit?'AND id=$2':''} ORDER BY created_at DESC,id LIMIT 201`,[JSON.stringify([{workflow_id:workflow.id}]),...(explicit?[explicit.release_id]:[])])).rows;
    requireValue(releases.length<=200,'候选release过多，须明确固定定义');
    const candidates=[];
    for(const release of releases){
      const fixed=release.payload.workflows.find(w=>w.workflow_id===workflow.id&&(!explicit||w.id===explicit.workflow_definition_version_id));
      if(!fixed)continue;
      const ids=new Set(fixed.payload.activities.map(a=>a.activity_version_id)),activities=release.payload.activities.filter(a=>ids.has(a.id));
      let identity,expected;
      try{expected=expectedPath(fixed,activities);identity=scriptRuntimeIdentity(task,spec,release,fixed,activities,runId,patrol);}catch{continue;}
      if(explicit&&explicit.snapshot_sha256!==fixed.payload_sha256)continue;
      const gate=await getReleaseGate(client,release.id);
      if(gate.deployed&&(!explicit?.observation_id||explicit.observation_id===gate.current_observation_id))candidates.push({release,fixed,identity,expected,observationId:gate.current_observation_id});
    }
    requireValue(candidates.length===1,'没有唯一来源匹配且已部署的完整固定定义');
    const {release,fixed,identity,expected,observationId}=candidates[0];
    const hash=identity.runtime_snapshot_sha256;
    if(explicit?.runtime_snapshot_sha256!==undefined)requireValue(explicit.runtime_snapshot_sha256===hash,'任务自报runtime摘要与实际执行不符');
    const definition={release_id:release.id,observation_id:observationId,workflow_id:workflow.id,workflow_definition_version_id:fixed.id,
      snapshot_sha256:fixed.payload_sha256,runtime_snapshot_sha256:hash,expected_path:expected,attempt_key:runId,actor:'script-dispatch'};
    validateDeclaration(explicit,definition);
    const result=await startRun({taskId:task.id,runId,source:'script',context:runContext(task,fixed,context,identity),definition},{pool,transactionClient:client});
    await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw Object.assign(Error(error.code==='script_definition_unverified'?error.message:'固定定义起跑核验失败'),{code:'script_definition_unverified'});}
  finally{client.release();}
}
