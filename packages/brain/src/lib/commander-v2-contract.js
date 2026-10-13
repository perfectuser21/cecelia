/** Commander v2：只接受固定合同，业务数据不参与shell构造。 */
import Ajv from 'ajv';
import { createHash, randomUUID } from 'node:crypto';
export const PROTOCOL = 'commander-v2';
export const isCommanderV2 = task => task?.payload?.commander_protocol === PROTOCOL;
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function requireCommander(value, message, status = 422) {
  if (!value) throw Object.assign(Error(message), { status, code: 'COMMANDER_CONTRACT' });
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return object(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
}
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function bounded(value, bytes, label) {
  requireCommander(value !== undefined && Buffer.byteLength(JSON.stringify(value)) <= bytes, `${label}缺失或超限`);
}
const ajv = new Ajv({ allErrors: true, strict: false });
function validateSchema(value, schema, label, code = 'COMMANDER_CONTRACT') {
  const check = ajv.compile(schema);
  if (!check(value)) throw Object.assign(Error(`${label}不符合同: ${ajv.errorsText(check.errors)}`), { status: 422, code });
}
function diagnosticValue(value, depth = 0) {
  if (typeof value === 'string') return value.slice(0, 1000);
  if (!value || typeof value !== 'object') return value;
  if (depth >= 4) return { omitted: true, sha256: digest(value) };
  if (Array.isArray(value)) return value.slice(0, 12).map(v => diagnosticValue(v, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 15).map(([key, v]) => [key, diagnosticValue(v, depth + 1)]));
}
function previousDiagnosis(previousControl) {
  if (!previousControl) return undefined;
  const { envelope, failure, verification } = previousControl;
  const source = { failure, verification };
  const diagnosis = { run_id: envelope.run_id, attempt: envelope.attempt, diagnostic_sha256: digest(source),
    failure: diagnosticValue(failure), verification: diagnosticValue(verification) };
  if (Buffer.byteLength(JSON.stringify(diagnosis)) > 30000) {
    const text = value => typeof value === 'string' ? value.slice(0, 500) : undefined;
    diagnosis.truncated = true;
    diagnosis.failure = { reason: text(failure?.reason), code: text(failure?.code), error_fingerprint: failure?.error_fingerprint };
    diagnosis.verification = { verdict: verification?.verdict,
      assertions: (verification?.assertions ?? []).slice(0, 8).map(a => ({ name: text(a.name), pass: a.pass === true, status: text(a.status), detail: text(a.detail) })),
      evidence: (verification?.evidence ?? []).slice(0, 8).map(v => typeof v === 'string' ? text(v) : { ref: text(v?.ref), path: text(v?.path), url: text(v?.url) }) };
  }
  bounded(diagnosis, 30000, '恢复诊断'); return diagnosis;
}
export function validateContract(task, contract) {
  requireCommander(isCommanderV2(task), '必须显式选择commander-v2');
  requireCommander(typeof task.payload.workflow_key === 'string' && task.payload.workflow_key.length <= 200, 'workflow_key无效');
  bounded(contract, 200000, '冻结合同'); bounded(task.payload.workflow_input, 100000, 'workflow_input');
  requireCommander(object(contract) && object(contract.input_schema), '固定合同缺input_schema');
  validateSchema(task.payload.workflow_input, contract.input_schema, 'workflow_input');
  if (contract.output_schema !== undefined) ajv.compile(contract.output_schema);
  requireCommander(object(contract.resources), '合同缺resources');
  const r = contract.resources;
  if (r.device_serial) for (const k of ['device_serial', 'machine', 'profile', 'account_ref']) {
    requireCommander(typeof r[k] === 'string' && /^[\p{L}\p{N}._-]{1,200}$/u.test(r[k]), `资源${k}缺失或非法`);
  }
  const p = contract.recovery ?? {};
  const policy = { ...p, max_attempts: p.max_attempts ?? 1, total_timeout_sec: p.total_timeout_sec ?? 2400, cleanup_timeout_sec: p.cleanup_timeout_sec ?? 300 };
  for (const [k, max] of [['max_attempts', 10], ['total_timeout_sec', 14400], ['cleanup_timeout_sec', 1800]]) {
    requireCommander(Number.isInteger(policy[k]) && policy[k] > 0 && policy[k] <= max, `恢复预算${k}越界`);
  }
  requireCommander(policy.total_timeout_sec + policy.cleanup_timeout_sec <= 14400, '执行加收尾预算超过资源租约上限');
  if (policy.improvement_after_failures !== undefined) requireCommander(Number.isInteger(policy.improvement_after_failures) && policy.improvement_after_failures > 0 && policy.improvement_after_failures <= 100, '改进阈值越界');
  return policy;
}
export function makeEnvelope(task, definition, contract, previous, now = new Date(), previousControl) {
  const recovery = { ...validateContract(task, contract), ...(previousControl ? { previous_attempt: previousDiagnosis(previousControl) } : {}) };
  const attempt = previous ? previous.attempt + 1 : 1;
  const deadline_at = previous?.deadline_at ?? new Date(now.getTime() + recovery.total_timeout_sec * 1000).toISOString();
  const cleanup_deadline_at = previous?.cleanup_deadline_at ?? new Date(Date.parse(deadline_at) + recovery.cleanup_timeout_sec * 1000).toISOString();
  requireCommander(attempt <= recovery.max_attempts && Date.parse(deadline_at) > now.getTime(), '恢复总预算已耗尽', 409);
  const run_id = `wfd-${randomUUID()}`;
  const envelope = { protocol: PROTOCOL, task_id: task.id, run_id, workflow_key: task.payload.workflow_key,
    attempt, owner_epoch: (previous?.owner_epoch ?? 0) + 1, deadline_at, cleanup_deadline_at,
    input: task.payload.workflow_input, input_sha256: digest(task.payload.workflow_input),
    definition: { ...definition, attempt_key: `${task.id}:${attempt}`, actor: 'workflow-commander' }, contract, recovery };
  bounded(envelope, 180000, '信封'); return envelope;
}
export function validateReady(ready, definition) {
  requireCommander(ready?.protocol === PROTOCOL && ready.ready === true, '运行端协议未ready', 409);
  for (const k of ['release_id', 'snapshot_sha256', 'runtime_snapshot_sha256']) {
    requireCommander(typeof definition[k] === 'string' && ready[k] === definition[k], `运行端部署漂移:${k}`, 409);
  }
}
export function validateDelivery(d, e) {
  requireCommander(object(d), 'delivery缺失');
  for (const k of ['protocol', 'task_id', 'run_id', 'attempt', 'owner_epoch', 'input_sha256']) requireCommander(d[k] === e[k], `delivery身份不符:${k}`, 409);
  requireCommander(digest(d.input) === e.input_sha256 && digest(d.definition) === digest(e.definition), 'delivery输入或定义不符', 409);
  requireCommander(['completed', 'failed', 'blocked'].includes(d.status), 'delivery终态无效');
  requireCommander(d.outputs !== undefined, 'delivery缺outputs');
  requireCommander(Array.isArray(d.evidence) && Array.isArray(d.effects) && object(d.cleanup) && Array.isArray(d.cleanup.evidence) && typeof d.cleanup.completed === 'boolean', 'delivery证据/副作用/收尾缺失');
  for (const effect of d.effects) requireCommander(typeof effect.key === 'string' && !effect.key.includes(e.run_id) && ['none', 'committed', 'compensated', 'unknown'].includes(effect.status), 'effects状态无效');
  if (d.status === 'completed' && e.contract.output_schema !== undefined) validateSchema(d.outputs, e.contract.output_schema, 'outputs', 'COMMANDER_OUTPUT_CONTRACT_INVALID');
}
export function recoveryAllowed(control, reason, now = new Date()) {
  const e = control.envelope;
  return control.execution_stopped === true && e.recovery.retry_safe === true
    && control.verification?.evidence?.length > 0
    && control.verification?.assertions?.some(a => a.name === 'effects_safe_to_retry' && a.pass === true)
    && e.recovery.retry_on?.includes(reason) && e.attempt < e.recovery.max_attempts
    && Date.parse(e.deadline_at) > now.getTime() && control.delivery?.cleanup?.completed === true
    && control.delivery.effects.every(x => ['none', 'compensated'].includes(x.status)
      || control.verification.assertions.some(a => a.name === `effect:${x.key}` && a.pass === true
        && ['none', 'compensated'].includes(a.status) && Array.isArray(a.evidence) && a.evidence.length > 0));
}
