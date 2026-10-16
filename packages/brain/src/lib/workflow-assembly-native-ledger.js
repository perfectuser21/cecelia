/** canonical runs拥有者；只有锁内INSERT成功才允许原runner继续。 */
import {definitionDigest} from '../workflow-authoring/contracts.js';
import {normalizeSpan,writeSpans} from './span-ingestion.js';
import {nativeSpec as spec} from './workflow-assembly-native-source.js';
const conflict=()=>{throw Object.assign(Error('native_run_identity_conflict'),{status:409});};
/** 只能在原runner会话锁内调用；锁证明旧handler已结束，禁止仅靠TTL抢终态。 */
export async function recoverNativeRounds(db){
  return db.query(`UPDATE runs SET outcome='unknown',ended_at=clock_timestamp(),updated_at=NOW(),
    detail=detail||'{"reason":"owner_interrupted","business_qualification":false}'::jsonb
    WHERE workflow_id=$1 AND outcome='running' AND header_source='owner' AND executor_id='brain-native-maintenance'
      AND detail->>'protocol'=$2`,[spec.id,spec.protocol]);
}
export async function claimNativeRound(db,{runId,requestKey,trigger,source}){
  const state=(await db.query(`SELECT w.current_definition_version_id AS version_id,v.payload,v.source_commit,v.source_repo,v.source_path,
    jsonb_build_object('id',e.id,'source',e.source,'host_alias',e.host_alias,'label',e.label,'kind',e.kind,'ops_workflow_id',e.ops_workflow_id) AS schedule,
    e.workflow_id AS schedule_workflow_id,o.workflow_id AS ops_workflow_id,o.source AS ops_source,o.wf_id AS ops_job,o.machine AS ops_host
    FROM workflows w JOIN workflow_definition_versions v ON v.id=w.current_definition_version_id AND v.workflow_id=w.id
    JOIN ops_schedule_entries e ON e.id=$2 JOIN ops_workflows o ON o.id=e.ops_workflow_id
    WHERE w.id=$1 AND w.status='active'`,[spec.id,spec.schedule.id])).rows[0];
  if(!state||state.payload.protocol!==spec.protocol||state.source_commit!==source.commit||state.source_repo!==source.repo||state.source_path!==source.path
    ||Object.entries(spec.schedule).some(([key,value])=>String(state.schedule[key])!==String(value))
    ||state.ops_source!=='scheduler'||state.ops_job!==spec.schedule.label||state.ops_host!==spec.schedule.host_alias
    ||state.schedule_workflow_id!==spec.id||state.ops_workflow_id!==spec.id||definitionDigest(state.payload.contract)!==definitionDigest(spec))conflict();
  const slot=state.payload.activities[0];
  if(state.payload.activities.length!==1||slot.activity_id!==spec.activities[0].id)conflict();
  const active=(await db.query(`SELECT a.contract,av.payload FROM workflow_activity_refs r
    JOIN activities a ON a.id=r.activity_id JOIN activity_definition_versions av ON av.activity_id=a.id AND av.id=r.activity_definition_version_id
    WHERE r.id=$1 AND r.workflow_id=$2 AND r.active AND r.slot_key=$3 AND r.sequence_no=1 AND a.status='active'
      AND a.workflow_id=$2 AND a.current_definition_version_id=$4 AND av.id=$4
      AND r.source_repo=$5 AND r.source_path=$6`,[slot.reference_id,spec.id,spec.activities[0].key,slot.activity_version_id,source.repo,source.path])).rows[0];
  if(!active||definitionDigest(active.contract)!==definitionDigest(spec.activities[0])
    ||definitionDigest(active.payload.contract)!==definitionDigest(spec.activities[0]))conflict();
  const identity={protocol:spec.protocol,scope:'global_admin',workflow_id:spec.id,workflow_definition_version_id:state.version_id,
    activity_id:slot.activity_id,activity_definition_version_id:slot.activity_version_id,input:{budget_ms:20000,limit:5},source};
  const detail={...identity,input_sha256:definitionDigest(identity.input),request_key:requestKey,formal_release:false};
  await recoverNativeRounds(db);
  const created=(await db.query(`INSERT INTO runs(run_id,workflow_id,trigger_kind,trigger_ref,schedule_entry_id,executor_kind,executor_id,started_at,outcome,detail,header_source)
    VALUES($1,$2,$3,$4,$5,'code','brain-native-maintenance',clock_timestamp(),'running',$6,'owner') ON CONFLICT(run_id) DO NOTHING RETURNING *`,
    [runId,spec.id,trigger,requestKey,spec.schedule.id,detail])).rows[0];
  const row=created??(await db.query('SELECT * FROM runs WHERE run_id=$1',[runId])).rows[0];
  if(!row||row.workflow_id!==spec.id||Object.keys(detail).some(key=>definitionDigest(row.detail?.[key]??null)!==definitionDigest(detail[key])))conflict();
  return {created:Boolean(created),row,detail};
}
export async function finishNativeRound(db,claim,report,result,error){
  await db.query('BEGIN');
  try{
    await db.query("SET LOCAL statement_timeout='5000ms'");
    // 保留PostgreSQL微秒，避免pg Date截成毫秒后ended_at反而早于同毫秒的started_at。
    const ended=(await db.query('SELECT clock_timestamp()::text AS at')).rows[0].at;
    const detail={...claim.detail,report,reason:result.reason,business_qualification:false};
    await writeSpans(db,[normalizeSpan({run_id:claim.row.run_id,workflow_id:spec.id,activity_id:spec.activities[0].id,
      executor_kind:'code',executor_id:'brain-native-maintenance',started_at:claim.row.started_at,ended_at:ended,
      occurrence_key:'native-reconcile-round',outcome:result.outcome==='pass'?'pass':result.outcome==='fail'?'fail':'unknown',
      evidence:detail},0)],{transactionClient:db});
    const updated=await db.query(`UPDATE runs SET ended_at=$2,outcome=$3,error=$4,detail=$5,updated_at=NOW()
      WHERE run_id=$1 AND outcome='running' AND header_source='owner' RETURNING *`,[claim.row.run_id,ended,result.outcome,error?'native_round_error':null,detail]);
    if(updated.rows.length!==1)conflict();
    await db.query('COMMIT');return updated.rows[0];
  }catch(e){await db.query('ROLLBACK');throw e;}
}
