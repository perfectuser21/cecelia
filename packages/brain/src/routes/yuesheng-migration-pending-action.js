import { transaction } from '../execution-directory/store.js';
import { OWNER_DECISION_ACTION_TYPE, YUESHENG_MIGRATION_SOURCE } from '../lib/owner-decision.js';
import { internalAuth, internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { actionParams, actionSignature, lockMaintenanceScope, route, taskId, validLeaseVersion, validSourceCommit } from '../lib/yuesheng-migration-scope.js';
import { issueYueshengMigrationApproval } from '../lib/yuesheng-migration-approval.js';

const ACTION_FIELDS = 'id, action_type, params, status, source, created_at, expires_at';
const failure = (status, code) => ({ status, body: { success: false, code } });

function validRequest(body) {
  return body && Object.keys(body).sort().join(',') === 'lease_version,source_commit'
    && validLeaseVersion(body.lease_version) && validSourceCommit(body.source_commit);
}

async function openPendingAction(pool, { lease_version, source_commit }) {
  return transaction(pool, async client => {
    const { task, lease } = await lockMaintenanceScope(client, lease_version);
    if (!task) return failure(409, 'YUESHENG_MIGRATION_TASK_UNAVAILABLE');
    if (!lease) return failure(409, 'YUESHENG_MIGRATION_LEASE_UNAVAILABLE');
    const signature = actionSignature(lease_version, lease.locked_at_exact);
    const params = actionParams(lease_version, source_commit);
    const { rows: [existing] } = await client.query(
      `SELECT ${ACTION_FIELDS} FROM pending_actions
       WHERE action_type = $1 AND source = $2 AND signature = $3`,
      [OWNER_DECISION_ACTION_TYPE, YUESHENG_MIGRATION_SOURCE, signature]);
    if (existing) {
      const matches = Object.entries(params).every(([key, value]) => existing.params?.[key] === value);
      return matches ? { status: 200, body: { success: true, action: existing } }
        : failure(409, 'YUESHENG_MIGRATION_ACTION_CONFLICT');
    }

    const context = { title: '悦升云机 ADB 通道迁移待批', task_id: taskId,
      device_name: route.physical_serial, from_port: 5044, to_port: 5045 };
    const { rows: [action] } = await client.query(
      `INSERT INTO pending_actions (action_type, source, signature, params, context, status, expires_at, category, comments)
       SELECT $1, $2, $3, $4::jsonb, $5::jsonb, 'pending_approval', $6::timestamptz, 'approval', '[]'::jsonb
       WHERE $6::timestamptz > clock_timestamp()
       RETURNING ${ACTION_FIELDS}`,
      [OWNER_DECISION_ACTION_TYPE, YUESHENG_MIGRATION_SOURCE, signature, JSON.stringify(params), JSON.stringify(context), lease.expires_at_exact]);
    return action ? { status: 201, body: { success: true, action } }
      : failure(409, 'YUESHENG_MIGRATION_LEASE_UNAVAILABLE');
  });
}

export function registerYueshengMigrationPendingAction(router, pool) {
  router.post('/tasks/:id/yuesheng-adb-migration/pending-action', internalAuthOrLoopback, async (req, res) => {
    if (req.params.id !== taskId) return res.status(404).json(failure(404, 'YUESHENG_MIGRATION_TASK_UNKNOWN').body);
    if (!validRequest(req.body)) return res.status(400).json(failure(400, 'YUESHENG_MIGRATION_REQUEST_INVALID').body);
    try {
      const { status, body } = await openPendingAction(pool, req.body);
      return res.status(status).json(body);
    } catch {
      return res.status(500).json(failure(500, 'YUESHENG_MIGRATION_ACTION_OPEN_FAILED').body);
    }
  });
  router.post('/tasks/:id/yuesheng-adb-migration/approval', (req, res, next) => {
    if (!process.env.CECELIA_INTERNAL_TOKEN) {
      return res.status(503).json(failure(503, 'YUESHENG_MIGRATION_APPROVAL_AUTH_UNCONFIGURED').body);
    }
    return internalAuth(req, res, next);
  }, async (req, res) => {
    if (req.params.id !== taskId) return res.status(404).json(failure(404, 'YUESHENG_MIGRATION_TASK_UNKNOWN').body);
    try {
      const approval = await issueYueshengMigrationApproval(pool, req.body, { principal: 'authenticated-operator' });
      return res.json({ success: true, approval });
    } catch (error) {
      const status = error.status ?? 500;
      return res.status(status).json(failure(status, error.status ? error.code : 'YUESHENG_MIGRATION_APPROVAL_FAILED').body);
    }
  });
}
