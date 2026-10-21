import {isAssemblyReconcileEnvironment} from './workflow-assembly-reconcile-derived.js';
import {createRoutedTask} from '../work-routing-store.js';
import {definitionDigest} from '../workflow-authoring/contracts.js';
const SKIP=new Set(['candidate_environment_unsupported','candidate_isolation_required','driver_unavailable','readiness_authorization_required','readiness_unavailable','readiness_identity_mismatch','resource_unavailable','resource_unknown','awaiting_execution']);
/** 调用者持事务；稳定问题键独立于router版本，completed仅作历史，不代表复验。 */
export async function ensureAssemblyGapTask(db,authoring,issue,{check=()=>{}}={}){
  check();
  if(SKIP.has(issue.gap?.code))return null;
  if(!/^[a-f0-9]{64}$/.test(issue.key??'') || !/^[a-z][a-z0-9_]{0,99}$/.test(issue.gap?.code??'')
    || issue.object_id!==authoring.id || issue.tenant_id!==(authoring.tenant_id??authoring.payload?.tenant_id??'default')
    || authoring.tenant_id && authoring.payload?.tenant_id && authoring.tenant_id!==authoring.payload.tenant_id
    || authoring.result?.workflow_authoring?.request?.execution_protocol!=='workflow-authoring-execution-v1'
    || issue.definition_sha256!==definitionDigest(authoring.result?.workflow_authoring?.outputs?.compose?.definition)
    || issue.target_version!==`candidate:${issue.definition_sha256}`)throw Error('gap_task_identity_mismatch');
  const actual=(await db.query('SELECT current_database() AS name')).rows[0]?.name;check();
  if(!isAssemblyReconcileEnvironment(actual))return null;
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,6))',[`assembly-gap:${issue.key}`]);check();
  const previous=(await db.query("SELECT id,status,payload->>'routing_receipt_id' AS routing_receipt_id FROM tasks WHERE payload->>'workflow_assembly_gap_key'=$1 ORDER BY created_at,id LIMIT 1",[issue.key])).rows[0];check();
  if(previous)return {task_id:previous.id,status:previous.status,routing_receipt_id:previous.routing_receipt_id,deduplicated:true};
  const receipt=await createRoutedTask(db,{
    source:'scheduler',source_id:`workflow-assembly-gap:${issue.key}`,
    title:`工作流装配缺口核查：${issue.gap.code}`,
    description:`只读核查原authoring ${authoring.id} 固定版本 ${issue.target_version} 的 ${issue.gap.code}。未知语义不得改合同、授权或正式对象；完成核查不能替代真实运行复验。`,
    requested_task_type:'research',declared_domain:'research',mutation_intent:'read_only',
    task:{project_id:authoring.project_id??null,parent_task_id:authoring.id,priority:'P2',
      payload:{tenant_id:issue.tenant_id,workflow_assembly_gap_key:issue.key,workflow_assembly_gap:{authoring_task_id:authoring.id,target_version:issue.target_version,definition_sha256:issue.definition_sha256,...issue.gap}}},
  },[],{transaction:'existing'});check();
  return {...receipt,status:receipt.task.status};
}
