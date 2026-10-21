/** 展示面只返回固定白名单元数据，不透出执行命令、任意context或日志。 */
import { getRelease, getReleaseGate } from './release-index.js';
import { getRunDefinitionBinding } from './run-definition-binding.js';
import { reconcileRunEvidence } from './run-reconciliation.js';
const pick=(row,keys)=>Object.fromEntries(keys.filter(k=>row?.[k]!==undefined).map(k=>[k,row[k]]));
// 仅信任原生维护拥有者记录指向的不可变版本；不使用对象current指针补历史。
const nativeRuns=`SELECT r.*,v.id AS fixed_version_id FROM runs r JOIN workflow_definition_versions v
  ON v.id::text=r.detail->>'workflow_definition_version_id' AND v.workflow_id=r.workflow_id
  WHERE r.workflow_id='3ef22c63-b721-4ca0-bbb9-36a17ea05bf6' AND r.header_source='owner' AND r.executor_id='brain-native-maintenance'
    AND r.detail->>'protocol'='workflow-assembly-native-v1' AND v.payload->>'protocol'='workflow-assembly-native-v1'
    AND v.payload->'contract'->>'key'='workflow_assembly_reconcile.internal'`;
function pagination({limit=20,offset=0}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0)throw Object.assign(Error('分页参数无效'),{status:400});
  return {limit,offset};
}
async function releaseSummary(db,row){
  return {...pick(row,['id','release_key','environment','target','created_at','manifest_sha256']),
    workflow_versions:(row.payload.workflows||[]).map(w=>({...pick(w,['id','workflow_id','payload_sha256','source_repo','source_commit']),key:w.payload?.key})),
    verification:row.payload.verification,gate:await getReleaseGate(db,row.id)};
}
export async function listSystemReleases(db,options={}) {
  const {limit,offset}=pagination(options),params=[options.workflowId||null];
  const filter=`WHERE ($1::uuid IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'workflows') w WHERE w->>'workflow_id'=$1::text))`;
  const total=Number((await db.query(`SELECT count(*) FROM release_versions ${filter}`,params)).rows[0].count);
  const rows=(await db.query(`SELECT * FROM release_versions ${filter} ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,[...params,limit,offset])).rows;
  const releases=[];for(const row of rows)releases.push(await releaseSummary(db,row));
  return {releases,total,limit,offset};
}
export async function listSystemRuns(db,options={}) {
  const {limit,offset}=pagination(options),params=[options.workflowId||null];
  const filter='WHERE ($1::uuid IS NULL OR workflow_id=$1)';
  // 原生命周期与旧执行段保留可见；没有固定绑定绝不事后追认版本。
  const source=`WITH native_runs AS (${nativeRuns}),run_records AS (
    SELECT id,run_id,release_id,workflow_id,workflow_definition_version_id,attempt_key,source_kind,created_at,
      jsonb_array_length(expected_path) expected_count,'bound' definition_status,'not_assessed' evidence_status,'run_definition_bindings' record_source FROM run_definition_bindings
    UNION ALL
    SELECT r.id,r.run_id,NULL,r.workflow_id,r.fixed_version_id,NULL,'internal',r.created_at,1,'native_fixed','native_observation','runs'
      FROM native_runs r WHERE NOT EXISTS(SELECT 1 FROM run_definition_bindings b WHERE b.run_id=r.run_id)
    UNION ALL
    SELECT t.id,t.run_id,NULL,t.workflow_id,NULL,NULL,'internal',t.created_at,NULL,'unknown','unknown','task_runs'
      FROM task_runs t WHERE NOT EXISTS(SELECT 1 FROM run_definition_bindings b WHERE b.run_id=t.run_id)
    UNION ALL
    SELECT min(s.id::text)::uuid,s.run_id,NULL,CASE WHEN count(DISTINCT s.workflow_id)=1 THEN min(s.workflow_id::text)::uuid END,
      NULL,NULL,'unknown',min(s.created_at),NULL,'unknown','unknown','spans'
      FROM spans s WHERE NOT EXISTS(SELECT 1 FROM run_definition_bindings b WHERE b.run_id=s.run_id)
      AND NOT EXISTS(SELECT 1 FROM task_runs t WHERE t.run_id=s.run_id)
      AND NOT EXISTS(SELECT 1 FROM native_runs r WHERE r.run_id=s.run_id) GROUP BY s.run_id
  )`;
  const total=Number((await db.query(`${source} SELECT count(*) FROM run_records ${filter}`,params)).rows[0].count);
  const runs=(await db.query(`${source} SELECT * FROM run_records ${filter} ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,[...params,limit,offset])).rows;
  return {runs,total,limit,offset};
}
function ciWorkflowVersions(item,workflows){
  const protocol=item.report?.protocol;
  const reported=protocol==='pilot_release_verification_v1'?item.report?.definition_versions?.workflows:
    protocol===undefined?item.report?.head?.definition_versions?.workflows:undefined,source=item.report?.source;
  if(!Array.isArray(reported)||!source)return [];
  const fields=['id','workflow_id','payload_sha256','source_repo','source_commit'];
  return workflows.filter(w=>w.source_repo===source.repo&&w.source_commit===source.head_revision
    &&reported.some(r=>r&&fields.every(key=>r[key]===w[key]))).map(w=>pick(w,fields));
}
export async function readSystemReleaseEvidence(db,id){
  const row=await getRelease(db,id);
  return {release:await releaseSummary(db,row),components:(row.payload.components||[]).map(c=>pick(c,['kind','repo','path','revision','digest'])),verification:row.payload.verification,
    ci_evidence:(row.payload.ci_evidence||[]).map(item=>({evidence_ref:item.evidence_ref,
      source:pick(item.report?.source,['repo','base_revision','head_revision']),
      ...pick(item.receipt,['report_sha256','verdict','recorded_at']),
      assertions:(item.receipt?.assertions||[]).map(a=>pick(a,['assertion_ref','source_repo','source_revision','test_sha256','exit_code'])),
      definition_versions:ciWorkflowVersions(item,row.payload.workflows||[])}))};
}
export async function readSystemRunEvidence(db,runId){
  const native=(await db.query(`SELECT * FROM (${nativeRuns}) r WHERE r.run_id=$1`,[runId])).rows[0];
  if(native){
    const spans=(await db.query('SELECT * FROM spans WHERE run_id=$1 ORDER BY started_at,id',[runId])).rows;
    const matching=spans.filter(s=>s.activity_id===native.detail.activity_id&&s.workflow_id===native.workflow_id
      &&s.evidence?.protocol==='workflow-assembly-native-v1'&&s.evidence?.workflow_definition_version_id===native.fixed_version_id
      &&s.evidence?.activity_definition_version_id===native.detail.activity_definition_version_id);
    return {run_id:runId,workflow_definition_version_id:native.fixed_version_id,native_maintenance:true,formal_release:false,
      business_outcome:'not_evaluated',evidence_status:matching.length===1&&spans.length===1?'native_observation':'missing_native_span',
      outcome:native.outcome,expected_count:1,span_count:spans.length,links:{task_id:null,task_run_id:null},
      spans:spans.map(s=>({...pick(s,['id','run_id','activity_id','started_at','ended_at','outcome','identity_protocol']),
        workflow_definition_version_id:s.evidence?.workflow_definition_version_id,activity_definition_version_id:s.evidence?.activity_definition_version_id}))};
  }
  const context=await getRunDefinitionBinding(db,runId);
  const spans=(await db.query('SELECT * FROM spans WHERE run_id=$1 ORDER BY started_at,id',[runId])).rows;
  const task=context?.binding.task_run_id?(await db.query('SELECT id,task_id,status FROM task_runs WHERE id=$1 AND run_id=$2',[context.binding.task_run_id,runId])).rows[0]:null;
  const result=reconcileRunEvidence({run_id:runId,context,spans,task_run:task||null});
  return {...pick(result,['run_id','run_binding_id','release_id','business_outcome','evidence_status','gaps','missing','unexpected','duration_ms','span_count','expected_count']),
    links:{task_run_id:task?.id||null,task_id:task?.task_id||null},
    spans:spans.map(s=>pick(s,['id','run_id','activity_id','step_id','enabler_id','reference_id','workflow_definition_version_id','activity_definition_version_id','attempt_key','occurrence_key','started_at','ended_at','outcome','identity_protocol']))};
}
