import { isDeepStrictEqual } from 'node:util';
import { transaction } from '../execution-directory/store.js';
import { digest } from '../phone-dispatch/identity.js';
import { OWNER_DECISION_ACTION_TYPE, YUESHENG_MIGRATION_SOURCE } from './owner-decision.js';
import { actionParams, actionSignature, lockMaintenanceScope, route, taskId, validLeaseVersion, validSourceCommit } from './yuesheng-migration-scope.js';

const approvalProtocol = 'yuesheng-adb-migration-approval/v1';
const principalName = 'authenticated-operator';
const operations = Object.freeze(['disconnect_old', 'connect_new']);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const approvalKey = 'yuesheng_adb_migration_approval';
const fail = (code, status = 409) => { throw Object.assign(Error(code), { code, status }); };
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasKeys = (value, keys) => isRecord(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const validUuid = value => typeof value === 'string' && uuid.test(value);
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

function validatePlan(request) {
  const plan = request?.plan;
  const lease = plan?.lease;
  const claim = plan?.claim;
  if (!hasKeys(request, ['plan', 'plan_sha256'])
    || !hasKeys(plan, ['protocol', 'task_id', 'pending_action_id', 'source_commit', 'release_id', 'observation_id', 'claim', 'lease', ...Object.keys(route)])
    || plan.protocol !== 'yuesheng-adb-migration-plan/v1' || plan.task_id !== taskId
    || !validSourceCommit(plan.source_commit) || ![plan.pending_action_id, plan.release_id, plan.observation_id].every(validUuid)
    || !Object.entries(route).every(([key, value]) => plan[key] === value)
    || !hasKeys(claim, ['claimed_by', 'claimed_at']) || typeof claim.claimed_by !== 'string' || !claim.claimed_by.trim()
    || !validTime(claim.claimed_at)
    || !hasKeys(lease, ['device_name', 'locked_by', 'lease_version', 'locked_at', 'expires_at', 'expired'])
    || lease.device_name !== route.physical_serial || lease.locked_by !== taskId || lease.expired !== false
    || !validLeaseVersion(lease.lease_version) || !validTime(lease.locked_at) || !validTime(lease.expires_at)
    || digest(plan) !== request.plan_sha256) fail('YUESHENG_MIGRATION_APPROVAL_PLAN_INVALID', 400);
  return plan;
}

function expectedReceipt(plan, planSha, approvedAt) {
  return { protocol: approvalProtocol, plan_sha256: planSha, actions: operations,
    approved_by: principalName, approved_at: approvedAt, approval_ref: 'pending-action:' + plan.pending_action_id,
    pending_action_id: plan.pending_action_id, task_id: taskId, device_name: route.physical_serial,
    lease_version: plan.lease.lease_version, source_commit: plan.source_commit };
}

async function verifyPriorApproval(db, previous, current) {
  if (previous === undefined) return;
  if (!isRecord(previous) || previous.protocol !== approvalProtocol || previous.task_id !== taskId
    || previous.device_name !== route.physical_serial || !validUuid(previous.pending_action_id)
    || !validLeaseVersion(previous.lease_version) || previous.lease_version === current.lease_version
    || previous.pending_action_id === current.pending_action_id) fail('YUESHENG_MIGRATION_APPROVAL_CONFLICT');
  const { rows: [priorAction] } = await db.query(
    `SELECT execution_result FROM pending_actions WHERE id = $1 AND action_type = $2 AND source = $3 AND status = 'approved'`,
    [previous.pending_action_id, OWNER_DECISION_ACTION_TYPE, YUESHENG_MIGRATION_SOURCE]);
  if (!priorAction || !isDeepStrictEqual(previous, priorAction.execution_result)) fail('YUESHENG_MIGRATION_APPROVAL_CONFLICT');
}

export async function issueYueshengMigrationApproval(pool, request, { principal } = {}) {
  if (principal !== principalName) fail('YUESHENG_MIGRATION_APPROVAL_AUTH_REQUIRED', 401);
  const plan = validatePlan(request);
  return transaction(pool, async db => {
    const { task, lease } = await lockMaintenanceScope(db, plan.lease.lease_version);
    if (!task || task.claimed_by !== plan.claim.claimed_by || task.claimed_at.toISOString() !== plan.claim.claimed_at)
      fail('YUESHENG_MIGRATION_APPROVAL_CLAIM_CHANGED');
    if (!lease || lease.locked_at.toISOString() !== plan.lease.locked_at || lease.expires_at.toISOString() !== plan.lease.expires_at)
      fail('YUESHENG_MIGRATION_APPROVAL_LEASE_CHANGED');
    if (task.result !== null && !isRecord(task.result)) fail('YUESHENG_MIGRATION_APPROVAL_CONFLICT');

    const { rows: [action] } = await db.query(
      `SELECT status, params, signature, execution_result, reviewed_by, clock_timestamp() AS signed_at
       FROM pending_actions WHERE id = $1 AND action_type = $2 AND source = $3
         AND expires_at = $4::timestamptz AND expires_at > clock_timestamp() FOR UPDATE`,
      [plan.pending_action_id, OWNER_DECISION_ACTION_TYPE, YUESHENG_MIGRATION_SOURCE, lease.expires_at_exact]);
    const leaseVersion = plan.lease.lease_version;
    if (!action || !isDeepStrictEqual(action.params, actionParams(leaseVersion, plan.source_commit))
      || action.signature !== actionSignature(leaseVersion, lease.locked_at_exact))
      fail('YUESHENG_MIGRATION_APPROVAL_REQUEST_CHANGED');

    const previous = task.result?.[approvalKey];
    if (action.status === 'approved') {
      const approvedAt = action.execution_result?.approved_at;
      const expected = expectedReceipt(plan, request.plan_sha256, approvedAt);
      if (action.reviewed_by !== principalName || !validTime(approvedAt)
        || !isDeepStrictEqual(action.execution_result, expected) || !isDeepStrictEqual(previous, expected))
        fail('YUESHENG_MIGRATION_APPROVAL_CONFLICT');
      return action.execution_result;
    }
    if (action.status !== 'pending_approval' || action.execution_result !== null)
      fail('YUESHENG_MIGRATION_APPROVAL_REQUEST_CHANGED');

    const approval = expectedReceipt(plan, request.plan_sha256, action.signed_at.toISOString());
    await verifyPriorApproval(db, previous, approval);
    const serialized = JSON.stringify(approval);
    const actionWrite = await db.query(
      `UPDATE pending_actions SET status = 'approved', reviewed_by = $2, reviewed_at = $3::timestamptz,
         execution_result = $4::jsonb
       WHERE id = $1 AND status = 'pending_approval' AND expires_at > clock_timestamp()`,
      [plan.pending_action_id, principalName, approval.approved_at, serialized]);
    if (actionWrite.rowCount !== 1) fail('YUESHENG_MIGRATION_APPROVAL_REQUEST_CHANGED');
    const taskWrite = await db.query(
      `UPDATE tasks SET result = COALESCE(result, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb) WHERE id = $1`,
      [taskId, approvalKey, serialized]);
    if (taskWrite.rowCount !== 1) fail('YUESHENG_MIGRATION_APPROVAL_CLAIM_CHANGED');
    return approval;
  });
}
