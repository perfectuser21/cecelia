import { createHash } from 'node:crypto';

export const taskId = '8f5f6442-540f-48b6-9577-c21cd848aa02';
export const route = Object.freeze({ physical_serial: 'B114E2190975', transport_serial: '127.0.0.1:15555',
  old_endpoint: 'tcp:127.0.0.1:5044', new_endpoint: 'tcp:127.0.0.1:5045', new_instance_id: 'mmv-yuesheng-direct' });
export const validSourceCommit = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const validLeaseVersion = value => typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value)
  && Number(value) <= 4_294_967_295;
export const actionParams = (leaseVersion, sourceCommit) => ({
  protocol: 'yuesheng-adb-migration-request/v1', task_id: taskId, device_name: route.physical_serial,
  lease_version: leaseVersion, source_commit: sourceCommit,
});
export function actionSignature(leaseVersion, lockedAtExact) {
  const acquisition = createHash('sha256').update(lockedAtExact).digest('hex');
  return `yuesheng-adb-migration:${taskId}:${leaseVersion}:${acquisition}`;
}

export async function lockMaintenanceScope(db, leaseVersion) {
  const { rows: [task] } = await db.query(
    `SELECT claimed_by, claimed_at, claimed_at::text AS claimed_at_exact, result FROM tasks
     WHERE id = $1 AND status = 'in_progress' AND btrim(claimed_by) <> ''
       AND claimed_at <= clock_timestamp()
       AND payload ->> 'work_kind' = 'coding_review'
       AND payload -> 'scope' @> '["enable_mmv_yuesheng_5045"]'::jsonb
     FOR UPDATE`, [taskId]);
  if (!task) return {};
  const { rows: [lease] } = await db.query(
    `SELECT locked_at, locked_at::text AS locked_at_exact, expires_at, expires_at::text AS expires_at_exact
     FROM device_locks WHERE device_name = $1 AND locked_by = $2 AND xmin::text = $3
       AND locked_at >= $4::timestamptz AND locked_at <= clock_timestamp()
       AND expires_at > clock_timestamp()
     FOR UPDATE`, [route.physical_serial, taskId, leaseVersion, task.claimed_at_exact]);
  return { task, lease };
}
