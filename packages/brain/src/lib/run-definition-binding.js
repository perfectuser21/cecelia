/** 运行身份只绑定一次；运行生命周期仍由现有执行系统管理。 */
import defaultPool from '../db.js';
import { UUID,evidenceHash,evidenceObject,evidenceText,evidenceTransaction,requireEvidence,getRelease,evaluateReleaseObservation,getReleaseGate,lockReleaseTarget } from './release-index.js';
const HASH=/^[0-9a-f]{64}$/;
function validateInput(runId,input){
  evidenceText(runId,'run_id');
  evidenceObject(input,['release_id','observation_id','workflow_id','workflow_definition_version_id','snapshot_sha256','runtime_snapshot_sha256','expected_path','source_kind','task_run_id','external_origin','attempt_key','actor']);
  for(const key of ['release_id','observation_id','workflow_id','workflow_definition_version_id'])evidenceText(input[key],key,UUID);
  evidenceText(input.snapshot_sha256,'snapshot_sha256',HASH);
  if(input.source_kind==='external'||input.runtime_snapshot_sha256!==undefined)evidenceText(input.runtime_snapshot_sha256,'runtime_snapshot_sha256',HASH);
  for(const key of ['attempt_key','actor'])evidenceText(input[key],key);
  requireEvidence(['internal','external'].includes(input.source_kind),'source_kind无效');
  if(input.source_kind==='internal'){
    evidenceText(input.task_run_id,'task_run_id',UUID);requireEvidence(input.external_origin===undefined,'内部运行不接受external_origin');
  }else{
    evidenceText(input.external_origin,'external_origin');requireEvidence(input.task_run_id===undefined,'外部运行不得伪造task_run');
  }
  requireEvidence(Array.isArray(input.expected_path)&&input.expected_path.length>0&&input.expected_path.length<=10000,'expected_path必须明确');
  for(const entry of input.expected_path){
    evidenceObject(entry,['reference_id','activity_id','activity_definition_version_id','step_id','required']);
    for(const key of ['reference_id','activity_id','activity_definition_version_id'])evidenceText(entry[key],key,UUID);
    if(entry.step_id!==undefined)evidenceText(entry.step_id,'step_id',UUID);
    requireEvidence(entry.required===undefined||typeof entry.required==='boolean','required必须为布尔值');
  }
}
function validatePath(input,workflow,activities){
  const identities=new Set();
  for(const entry of input.expected_path){
    const reference=workflow.payload.activities.find(r=>r.reference_id===entry.reference_id);
    requireEvidence(reference&&reference.activity_id===entry.activity_id&&reference.activity_version_id===entry.activity_definition_version_id,'路径引用不属于固定Workflow');
    const activity=activities.find(a=>a.id===entry.activity_definition_version_id);
    requireEvidence(activity&&activity.activity_id===entry.activity_id,'路径Activity快照不存在');
    if(entry.step_id)requireEvidence(activity.payload.steps?.some(s=>s.step_id===entry.step_id&&s.locator.activity_id===entry.activity_id),'Step不属于固定Activity');
    if(entry.required===false){
      const contract=entry.step_id?activity.payload.steps.find(s=>s.step_id===entry.step_id)?.contract:activity.payload.contract;
      requireEvidence(contract?.optional===true||contract?.required===false||(typeof contract?.condition==='string'&&contract.condition.trim().length>0),'固定契约未声明可选或条件路径');
    }
    const key=`${entry.reference_id}:${entry.step_id||''}`;
    requireEvidence(!identities.has(key),'预期路径身份重复');identities.add(key);
  }
  for(const ref of workflow.payload.activities){
    requireEvidence(identities.has(`${ref.reference_id}:`),'预期路径缺少Activity层级');
    const activity=activities.find(a=>a.id===ref.activity_version_id);
    for(const step of activity.payload.steps||[])if(step.step_id)requireEvidence(identities.has(`${ref.reference_id}:${step.step_id}`),'预期路径缺少规范Step');
  }
}
async function lockRunProtocol(db,runId){
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,515))',[runId]);
  const table=(await db.query("SELECT to_regclass('spans') AS name")).rows[0].name;if(!table)return;
  const columns=(await db.query("SELECT attname FROM pg_attribute WHERE attrelid='spans'::regclass AND attnum>0 AND NOT attisdropped")).rows.map(r=>r.attname);
  if(!columns.includes('run_id'))return;
  const exists=(await db.query(`SELECT 1 FROM spans WHERE run_id=$1 ${columns.includes('identity_protocol')?'AND COALESCE(identity_protocol,1)=1':''} LIMIT 1`,[runId])).rows.length;
  requireEvidence(!exists,'已有旧协议span的运行不可追加新身份','LEGACY_RUN_CONFLICT',409);
}
export async function bindRunDefinition(pool,runId,input){
  return evidenceTransaction(pool,`run-definition:${runId}`,db=>bindRunDefinitionInTransaction(db,runId,input));
}
/** 调用方须已BEGIN；内部任务创建与固定身份共用提交/回滚。 */
export async function bindRunDefinitionInTransaction(db,runId,input){
  validateInput(runId,input);const hash=evidenceHash(input);
  await lockRunProtocol(db,runId);
  const existing=(await db.query('SELECT * FROM run_definition_bindings WHERE run_id=$1',[runId])).rows[0];
  if(existing){requireEvidence(existing.payload_sha256===hash,'run已绑定其他定义','CONFLICT',409);return {binding:existing,created:false};}
  if(input.source_kind==='external'){
    const internal=(await db.query('SELECT 1 FROM task_runs WHERE run_id=$1 LIMIT 1',[runId])).rows.length;
    requireEvidence(!internal,'run_id已属于内部task_run','RUN_SOURCE_CONFLICT',409);
  }
  const release=await getRelease(db,input.release_id);
  await lockReleaseTarget(db,release.environment,release.target);
  requireEvidence((await getReleaseGate(db,release.id)).deployed,'当前部署已漂移或release已替换','DEPLOYMENT_UNVERIFIED',409);
  const observation=(await db.query('SELECT * FROM release_observations WHERE id=$1 AND release_id=$2',[input.observation_id,input.release_id])).rows[0];
  requireEvidence(observation&&evaluateReleaseObservation(release,observation).deployed,'运行需要CI核验及匹配的实际部署观测','DEPLOYMENT_UNVERIFIED',409);
  const workflow=release.payload.workflows.find(w=>w.id===input.workflow_definition_version_id&&w.workflow_id===input.workflow_id);
  requireEvidence(workflow&&workflow.payload_sha256===input.snapshot_sha256,'运行Workflow固定版本或摘要不符');
  validatePath(input,workflow,release.payload.activities);
  if(input.source_kind==='internal'){
    const taskRun=(await db.query('SELECT id,run_id,workflow_id,status,ended_at,context FROM task_runs WHERE id=$1 FOR SHARE',[input.task_run_id])).rows[0];
    requireEvidence(taskRun&&taskRun.run_id===runId&&taskRun.workflow_id===input.workflow_id,'内部task_run不存在或运行/Workflow不一致');
    requireEvidence(taskRun.status==='running'&&taskRun.ended_at===null,'内部运行已结束或未处于起跑状态','RUN_PREFLIGHT_UNVERIFIED',409);
    const declaration=taskRun.context?.definition_preflight;
    requireEvidence(declaration&&typeof declaration==='object'&&!Array.isArray(declaration)&&['release_id','workflow_definition_version_id','snapshot_sha256','runtime_snapshot_sha256','attempt_key'].every(k=>declaration[k]===input[k]),'内部运行缺少匹配的起跑前定义声明','RUN_PREFLIGHT_UNVERIFIED',409);
  }
  const binding=(await db.query(`INSERT INTO run_definition_bindings(run_id,release_id,observation_id,workflow_id,workflow_definition_version_id,snapshot_sha256,
    expected_path,source_kind,task_run_id,external_origin,attempt_key,actor,payload_sha256,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[runId,input.release_id,input.observation_id,input.workflow_id,input.workflow_definition_version_id,
    input.snapshot_sha256,JSON.stringify(input.expected_path),input.source_kind,input.task_run_id||null,input.external_origin||null,input.attempt_key,input.actor,hash,input])).rows[0];
  return {binding,created:true};
}
export async function getRunDefinitionBinding(db,runId){
  evidenceText(runId,'run_id');db ||= defaultPool;
  const binding=(await db.query('SELECT * FROM run_definition_bindings WHERE run_id=$1',[runId])).rows[0];if(!binding)return null;
  const release=await getRelease(db,binding.release_id);
  const workflow=release.payload.workflows.find(w=>w.id===binding.workflow_definition_version_id&&w.workflow_id===binding.workflow_id);
  requireEvidence(workflow,'冻结release缺少绑定Workflow','SNAPSHOT_CORRUPT',409);
  const ids=new Set(workflow.payload.activities.map(a=>a.activity_version_id));
  return {binding,release,workflow,activities:release.payload.activities.filter(a=>ids.has(a.id))};
}
