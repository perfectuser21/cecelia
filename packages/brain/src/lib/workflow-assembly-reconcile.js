import { createHash } from 'node:crypto';
export {ensureAssemblyGapTask} from './workflow-assembly-reconcile-tasks.js';
export {runWorkflowAssemblyReconcile} from './workflow-assembly-reconcile-runner.js';
export {auditAssemblyDerivations} from './workflow-assembly-reconcile-derived.js';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const SHA = /^[a-f0-9]{64}$/;

/** 只消费服务器readiness；持久化到原authoring任务，不以修复任务状态替代复验。 */
export function reconcileGapState(previous, observation, {now = Date.now()} = {}) {
  const {tenant_id,object_id,target_version,definition_sha256} = observation;
  if (!tenant_id || !object_id || !target_version || !SHA.test(definition_sha256 ?? '')
    || previous && (previous.tenant_id !== tenant_id || previous.object_id !== object_id)) throw Error('reconcile_identity_invalid');
  const issues = structuredClone(previous?.issues ?? {});
  const current = new Set();
  for (const gap of observation.gaps ?? []) {
    const key=hash([tenant_id,object_id,target_version,definition_sha256,gap.code,gap.activity_key ?? null,gap.field ?? null]);
    current.add(key);
    issues[key]={...issues[key],key,tenant_id,object_id,target_version,definition_sha256,
      gap:{code:gap.code,activity_key:gap.activity_key ?? null,field:gap.field ?? null},status:'open',
      first_seen_at:issues[key]?.first_seen_at ?? now,detected_at:issues[key]?.status==='closed'?now:(issues[key]?.detected_at ?? now),last_seen_at:now};
    if (issues[key].verification_id) issues[key].last_verification_id=issues[key].verification_id;
    delete issues[key].verification_id;delete issues[key].verified_at;
  }
  const verified=observation.protocol==='workflow-authoring-execution-v1' && observation.status==='verified' && observation.qualified===true
    && observation.resource_condition==='ready' && !observation.gaps?.length
    && SHA.test(observation.proof_sha256 ?? '') && observation.verification_id===observation.proof_sha256;
  const finished=Date.parse(observation.verification_at ?? observation.latest_run_finished_at ?? '');
  for (const issue of Object.values(issues)) {
    if (issue.target_version!==target_version || issue.definition_sha256!==definition_sha256 || current.has(issue.key)) continue;
    if (issue.status==='closed' && !verified) continue;
    const fresh=verified && Number.isFinite(finished) && finished>Math.max(issue.detected_at ?? issue.first_seen_at,issue.repaired_at ?? 0);
    issue.status=fresh?'closed':'awaiting_verification';
    if (fresh) {issue.verification_id=observation.verification_id;issue.verified_at=now;}
  }
  const currentVerified=verified && !Object.values(issues).some(issue=>issue.target_version===target_version && issue.definition_sha256===definition_sha256 && issue.status!=='closed');
  const waiting=observation.resource_condition!=='ready';
  let attempts=previous?.resource_attempts ?? 0,next=previous?.next_check_at ?? 0;
  if (waiting && now>=next) {attempts++;next=now+Math.min(3600000,60000*2**Math.min(attempts-1,6));}
  if (!waiting) {attempts=0;next=0;}
  return {protocol:'workflow-assembly-reconcile-v1',tenant_id,object_id,target_version,definition_sha256,issues,
    status:waiting?'waiting_resource':currentVerified?'verified':'open',checked_at:now,next_check_at:next,
    resource_condition:observation.resource_condition ?? 'unknown',resource_attempts:attempts,qualified:observation.qualified===true,
    ...(currentVerified?{verification_id:observation.verification_id}: {})};
}
