import { createHash } from 'node:crypto';
import { directory } from '../execution-directory/directory.js';
import { authorize } from '../execution-directory/store.js';

const PROFILE_FIELDS = ['commander','role_assignments','routing','executor','provider','executor_account','model'];
const STAGE_ROLES = ['planner','proposer','reviewer','reporter','generator','evaluator','judge','publisher'];
const TARGET_FIELDS = ['machine','provider','account','model'];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonical(value[key])]),
  );
  return value;
}

export const profileValueKey = value => JSON.stringify(canonical(value));
export function rawExecutionProfile(payload = {}) {
  return canonical(Object.fromEntries(PROFILE_FIELDS.filter(key => Object.hasOwn(payload,key))
    .map(key => [key,payload[key]])));
}
export function executionProfileHash(payload) {
  return createHash('sha256').update(profileValueKey(rawExecutionProfile(payload))).digest('hex');
}

export function validRecoveryExecutionTarget(request) {
  const hasTarget = Object.hasOwn(request,'execution_target');
  const hasHash = Object.hasOwn(request,'expected_profile_hash');
  if (!hasTarget && !hasHash) return true;
  const target = request.execution_target;
  return hasTarget && hasHash && /^[a-f0-9]{64}$/.test(request.expected_profile_hash ?? '')
    && target && typeof target === 'object' && !Array.isArray(target)
    && Object.keys(target).every(key => TARGET_FIELDS.includes(key))
    && ['machine','provider','account'].every(key => typeof target[key] === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(target[key]) && target[key].length <= (key === 'machine' ? 256 : 128))
    && (!Object.hasOwn(target,'model') || (typeof target.model === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(target.model) && target.model.length <= 256));
}

function fail(code) {
  throw Object.assign(new Error(code), { code, status: 409 });
}

// 仅由已锁任务的failed/planning再基事务调用；不创建grant，也不替代实际launch准入。
export async function freezeRecoveryExecutionProfile(client, { task, request, repo }) {
  if (!request.execution_target) return { payload: {} };
  const previousProfileHash = executionProfileHash(task.payload);
  if (previousProfileHash !== request.expected_profile_hash) fail('recovery_rebase_profile_changed');
  const target = canonical(request.execution_target);
  const snapshot = directory.current();
  let auth;
  try {
    auth = await authorize(client, { snapshotVersion: snapshot?.version,
      machineId: target.machine, surface: 'harness', provider: target.provider,
      account: target.account, repo });
  } catch {
    fail('recovery_rebase_execution_denied');
  }
  const payload = {
    commander: { primary: target, fallbacks: [] },
    role_assignments: Object.fromEntries(STAGE_ROLES.map(role => [role,{ ...target, strict_affinity: true }])),
    routing: { ...(task.payload.routing ?? {}), preferred_machine: target.machine, strict_affinity: true },
    executor: target.provider, provider: target.provider, executor_account: target.account,
    model: target.model ?? 'auto',
  };
  return { payload, evidence: { target, previous_profile_hash: previousProfileHash,
    profile_hash: executionProfileHash(payload), frozen_profile: rawExecutionProfile(payload),
    execution_snapshot_version: snapshot.version, execution_version_id: auth.executionVersionId,
    grant_id: auth.grantId, repo } };
}
