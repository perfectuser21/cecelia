/** 配套声明仅来自冻结release，不能现场补全全局Skill。 */
import { digest, object, requireCommander } from './commander-v2-contract.js';
import { isCommanderVerification, verifiedRuntime } from './commander-verification-transport.js';
import { getRunDefinitionBinding } from './run-definition-binding.js';
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sourceDigest = value => typeof value === 'string' ? value.replace(/^sha256:/, '') : null;
function validateSource(activity, selected, kind) {
  const identity = selected?.implementation;
  requireCommander(object(identity) && identity.kind === kind && typeof identity.id === 'string' && identity.id.length > 0
    && typeof identity.version === 'string' && identity.version.length > 0 && hash(identity.digest)
    && typeof selected.path === 'string' && ![...selected.path].some(c => c === '\\' || c.charCodeAt(0) < 32) && !selected.path.startsWith('/')
    && !selected.path.split('/').some(p => ['.', '..', ''].includes(p))
    && (activity.payload.implementation_bindings ?? []).some(b => b.kind === kind && b.path === selected.path && sourceDigest(b.digest) === identity.digest
      && b.status === 'verified' && (b.version === undefined || String(b.version) === identity.version)),
  '实现路径或摘要与冻结来源不符');
}
export function primaryImplementation(activity, pairs) {
  const selected = activity.payload.commander_implementation;
  if (selected === undefined) return undefined;
  requireCommander(object(selected) && ['code', 'skill'].includes(selected.implementation?.kind)
    && selected.business_requirement_sha256 === digest(activity.payload.contract), '独立实现业务合同不符');
  validateSource(activity, selected, selected.implementation.kind);
  if (pairs) requireCommander(digest(selected.implementation) === digest(pairs.code.implementation) && selected.path === pairs.code.path, 'primary实现与配套Code不符');
  return structuredClone(selected);
}
export function pairedImplementations(activity) {
  const pairs = activity.payload.commander_implementations;
  if (pairs === undefined) return undefined;
  requireCommander(object(pairs) && pairs.business_requirement_sha256 === digest(activity.payload.contract), '配套实现业务合同不符');
  for (const kind of ['code', 'skill']) {
    validateSource(activity, pairs[kind], kind);
  }
  const ref = pairs.skill.verification_ref;
  requireCommander(object(ref) && typeof ref.task_id === 'string' && typeof ref.run_id === 'string' && hash(ref.definition_sha256), '配套Skill缺独立核验引用');
  return structuredClone(pairs);
}
export function validateExecutionEvidence(e, path, evidence = {}) {
  const binding = e.activity_bindings?.find(b => b.reference_id === path.reference_id);
  const pairs = binding?.implementations;
  const primary = binding?.primary_implementation;
  if (!pairs && primary) {
    requireCommander(object(evidence.implementation) && digest(evidence.implementation) === digest(primary.implementation)
      && evidence.execution_role === 'primary', '独立实现证据或执行归属不符');
    requireCommander(object(e.contract.environment) && digest(evidence.environment) === digest(e.contract.environment), '运行环境与冻结合同不符');
    return { executor_kind: primary.implementation.kind === 'code' ? 'code' : 'agent', executor_id: primary.implementation.id };
  }
  if (!pairs) {
    requireCommander(evidence.implementation === undefined && evidence.execution_role === undefined, '实现证据缺冻结配套声明');
    return null;
  }
  requireCommander(object(evidence.implementation) && ['primary', 'fallback', 'rescue'].includes(evidence.execution_role), '实现证据或执行归属缺失');
  const kind = evidence.implementation.kind, selected = pairs[kind];
  requireCommander(selected && digest(evidence.implementation) === digest(selected.implementation)
    && (evidence.execution_role === 'primary' ? kind === 'code' : kind === 'skill'), '实现证据或执行归属与冻结配套不符');
  requireCommander(object(e.contract.environment) && digest(evidence.environment) === digest(e.contract.environment), '运行环境与冻结合同不符');
  return { executor_kind: kind === 'code' ? 'code' : 'agent', executor_id: selected.implementation.id };
}
export async function verifySkillPairings(db, e) {
  for (const binding of e.activity_bindings ?? []) {
    const pairs = binding.implementations;
    if (!pairs) continue;
    const selected = pairs.skill, ref = selected.verification_ref;
    const proof = (await db.query('SELECT * FROM tasks WHERE id=$1', [ref.task_id])).rows[0];
    const v = proof?.result?.workflow_verification;
    requireCommander(proof && ['completed', 'completed_no_pr'].includes(proof.status) && isCommanderVerification(proof) && verifiedRuntime(proof)
      && v?.task_id === proof.parent_task_id && v.run_id === ref.run_id && v.definition_sha256 === ref.definition_sha256
      && v.verdict === 'PASS' && v.execution_role === 'primary' && object(v.implementation) && object(v.environment)
      && digest(v.implementation) === digest(selected.implementation)
      && object(e.contract.environment) && digest(v.environment) === digest(e.contract.environment)
      && Array.isArray(v.assertions) && v.assertions.length > 0 && v.assertions.every(a => a.pass === true)
      && v.assertions.some(a => a.name === 'cleanup' && a.pass === true) && Array.isArray(v.evidence) && v.evidence.length > 0,
    '配套Skill独立核验缺失、身份或环境不符', 409);
    const source = await getRunDefinitionBinding(db, ref.run_id);
    const run = source?.binding?.task_run_id ? (await db.query('SELECT task_id,status FROM task_runs WHERE id=$1 AND run_id=$2', [source.binding.task_run_id, ref.run_id])).rows[0] : null;
    requireCommander(run?.task_id === v.task_id && run.status === 'success' && source.workflow.payload_sha256 === ref.definition_sha256
      && object(source.workflow.payload.contract?.environment)
      && digest(source.workflow.payload.contract?.environment) === digest(e.contract.environment)
      && source.activities.some(a => digest(a.payload.contract) === pairs.business_requirement_sha256
        && object(a.payload.commander_implementation) && object(a.payload.commander_implementation.implementation)
        && a.payload.commander_implementation.business_requirement_sha256 === pairs.business_requirement_sha256
        && a.payload.commander_implementation.path === selected.path
        && digest(a.payload.commander_implementation.implementation) === digest(selected.implementation)
        && a.payload.commander_implementations === undefined
        && (a.payload.implementation_bindings ?? []).some(b => b.kind === 'skill' && b.path === selected.path
          && sourceDigest(b.digest) === selected.implementation.digest && b.status === 'verified' && String(b.version) === selected.implementation.version)),
    '配套Skill独立核验的冻结来源不匹配', 409);
  }
}
