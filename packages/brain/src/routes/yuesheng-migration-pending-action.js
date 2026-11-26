import { createHash } from 'node:crypto';
import { transaction } from '../execution-directory/store.js';
import { OWNER_DECISION_ACTION_TYPE, YUESHENG_MIGRATION_SOURCE } from '../lib/owner-decision.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';

const TASK_ID = '8f5f6442-540f-48b6-9577-c21cd848aa02';
const DEVICE_NAME = 'B114E2190975';
const PROTOCOL = 'yuesheng-adb-migration-request/v1';
const MAX_LEASE_XID = 4_294_967_295;
const ACTION_FIELDS = 'id, action_type, params, status, source, created_at, expires_at';
const failure = (status, code) => ({ status, body: { success: false, code } });

function validRequest(body) {
  return body && Object.keys(body).sort().join(',') === 'lease_version,source_commit'
    && typeof body.lease_version === 'string' && /^[1-9][0-9]{0,9}$/.test(body.lease_version)
    && Number(body.lease_version) <= MAX_LEASE_XID
    && typeof body.source_commit === 'string' && /^[a-f0-9]{40}$/.test(body.source_commit);
}

async function openPendingAction(pool, { lease_version, source_commit }) {
  return transaction(pool, async client => {
    const { rows: [task] } = await client.query(
      `SELECT claimed_at::text AS claimed_at FROM tasks
       WHERE id = $1 AND status = 'in_progress' AND btrim(claimed_by) <> ''
         AND claimed_at <= clock_timestamp()
         AND payload ->> 'work_kind' = 'coding_review'
         AND payload -> 'scope' @> '["enable_mmv_yuesheng_5045"]'::jsonb
       FOR UPDATE`, [TASK_ID]);
    if (!task) return failure(409, 'YUESHENG_MIGRATION_TASK_UNAVAILABLE');

    // Lock the task first, then the precise device row. Retries for the same
    // acquisition serialize without changing the maintenance claim or lease.
    const { rows: [lease] } = await client.query(
      `SELECT locked_at::text AS locked_at, expires_at::text AS expires_at FROM device_locks
       WHERE device_name = $1 AND locked_by = $2 AND xmin::text = $3
         AND locked_at >= $4::timestamptz AND locked_at <= clock_timestamp()
         AND expires_at > clock_timestamp()
       FOR UPDATE`, [DEVICE_NAME, TASK_ID, lease_version, task.claimed_at]);
    if (!lease) return failure(409, 'YUESHENG_MIGRATION_LEASE_UNAVAILABLE');

    const acquisition = createHash('sha256').update(lease.locked_at).digest('hex');
    const signature = `yuesheng-adb-migration:${TASK_ID}:${lease_version}:${acquisition}`;
    const params = { protocol: PROTOCOL, task_id: TASK_ID, device_name: DEVICE_NAME, lease_version, source_commit };
    const { rows: [existing] } = await client.query(
      `SELECT ${ACTION_FIELDS} FROM pending_actions
       WHERE action_type = $1 AND source = $2 AND signature = $3`,
      [OWNER_DECISION_ACTION_TYPE, YUESHENG_MIGRATION_SOURCE, signature]);
    if (existing) {
      const matches = Object.entries(params).every(([key, value]) => existing.params?.[key] === value);
      return matches ? { status: 200, body: { success: true, action: existing } }
        : failure(409, 'YUESHENG_MIGRATION_ACTION_CONFLICT');
    }

    const context = { title: '悦升云机 ADB 通道迁移待批', task_id: TASK_ID,
      device_name: DEVICE_NAME, from_port: 5044, to_port: 5045 };
    const { rows: [action] } = await client.query(
      `INSERT INTO pending_actions (action_type, source, signature, params, context, status, expires_at, category, comments)
       SELECT $1, $2, $3, $4::jsonb, $5::jsonb, 'pending_approval', $6::timestamptz, 'approval', '[]'::jsonb
       WHERE $6::timestamptz > clock_timestamp()
       RETURNING ${ACTION_FIELDS}`,
      [OWNER_DECISION_ACTION_TYPE, YUESHENG_MIGRATION_SOURCE, signature, JSON.stringify(params), JSON.stringify(context), lease.expires_at]);
    return action ? { status: 201, body: { success: true, action } }
      : failure(409, 'YUESHENG_MIGRATION_LEASE_UNAVAILABLE');
  });
}

export function registerYueshengMigrationPendingAction(router, pool) {
  router.post('/tasks/:id/yuesheng-adb-migration/pending-action', internalAuthOrLoopback, async (req, res) => {
    if (req.params.id !== TASK_ID) return res.status(404).json(failure(404, 'YUESHENG_MIGRATION_TASK_UNKNOWN').body);
    if (!validRequest(req.body)) return res.status(400).json(failure(400, 'YUESHENG_MIGRATION_REQUEST_INVALID').body);
    try {
      const { status, body } = await openPendingAction(pool, req.body);
      return res.status(status).json(body);
    } catch {
      return res.status(500).json(failure(500, 'YUESHENG_MIGRATION_ACTION_OPEN_FAILED').body);
    }
  });
}
