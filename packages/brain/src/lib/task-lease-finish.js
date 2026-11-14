import { createHash } from 'node:crypto';
import { isExternalWorkerTask } from './task-type-registry.js';
import { afterTerminalTransition, finalizeTask } from './task-terminal.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const validClaimEpoch = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value)
  && Number.isFinite(Date.parse(value));
const canonical = (value, depth = 0) => {
  if (depth > 20) throw Error('result too deep');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw Error('invalid result');
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], depth + 1)]));
};
const response = (status, error) => ({ status, body: { error } });

/** External business results cannot write top-level controller authority or coding PR state. */
export async function finishTaskLease(pool, { taskId, claimer, claimEpoch, status, result } = {}, { afterTransition = afterTerminalTransition } = {}) {
  let serialized;
  try {
    if (!UUID.test(taskId ?? '') || typeof claimer !== 'string' || !claimer.trim() || claimer.length > 200
      || !validClaimEpoch(claimEpoch) || !['completed', 'failed'].includes(status)
      || !result || Array.isArray(result) || typeof result !== 'object') return response(400, 'invalid_lease_receipt');
    serialized = JSON.stringify(canonical(result));
    if (Buffer.byteLength(serialized) > 65536) return response(400, 'invalid_lease_receipt');
  } catch { return response(400, 'invalid_lease_receipt'); }
  const digest = createHash('sha256').update(serialized).digest('hex');
  let receipt;
  const db = await pool.connect();
  let committed = false;
  let outcome;
  try {
    await db.query('BEGIN');
    const task = (await db.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [taskId])).rows[0];
    if (!task) { await db.query('ROLLBACK'); return response(404, 'task_not_found'); }
    if (!isExternalWorkerTask(task) || task.executor_kind !== 'external-worker'
      || task.payload?.commander_protocol === 'commander-v2' || task.payload?.work_kind === 'coding_mutation'
      || task.result?.workflow_control || task.result?.workflow_common_runner) {
      await db.query('ROLLBACK'); return response(409, 'lease_finish_not_allowed');
    }
    // Task then lease order matches claim/start, heartbeat, and the public reaper.
    await db.query('SELECT task_id FROM task_leases WHERE task_id=$1 FOR UPDATE', [taskId]);
    const lease = (await db.query(`SELECT l.*, l.claimed_at::text AS canonical_claim_epoch, l.claimed_at=$2::timestamptz AS epoch_matches,
        l.lease_until>clock_timestamp() AS active,
        EXISTS(SELECT 1 FROM tasks t WHERE t.id=l.task_id AND t.claimed_by=l.claimer
          AND t.claimed_at=l.claimed_at AND t.status='in_progress') AS task_matches
      FROM task_leases l WHERE l.task_id=$1`, [taskId, claimEpoch])).rows[0];
    receipt = { claimer, claim_epoch: lease?.canonical_claim_epoch, status, result_sha256: digest };
    const stored = task.result?.lease_receipt;
    if (['completed', 'failed'].includes(task.status) && stored) {
      if (lease?.epoch_matches === true && lease.claimer === claimer && lease.source === 'claim'
        && stored.claimer === claimer && stored.claim_epoch === lease.canonical_claim_epoch && stored.status === status
        && task.status === status && stored.result_sha256 === digest && lease.released_at) {
        await db.query('COMMIT'); committed = true;
        return { status: 200, body: { ok: true, task_id: taskId, status, replayed: true, receipt: stored } };
      }
      await db.query('ROLLBACK'); return response(409, 'lease_receipt_conflict');
    }
    if (task.status !== 'in_progress' || task.claimed_by !== claimer || lease?.task_matches !== true
      || lease.epoch_matches !== true || lease.claimer !== claimer || lease.source !== 'claim'
      || lease.active !== true || lease.released_at) {
      await db.query('ROLLBACK'); return response(409, 'lease_lost');
    }
    outcome = await finalizeTask(db, taskId, status, {
      relay: false, onlyIfStatus: 'in_progress',
      where: { sql: `claimed_by=$1 AND claimed_at=$2::timestamptz AND EXISTS(SELECT 1 FROM task_leases l
        WHERE l.task_id=tasks.id AND l.claimer=$1 AND l.claimed_at=$2::timestamptz
          AND l.released_at IS NULL AND l.lease_until>clock_timestamp())`, params: [claimer, claimEpoch] },
      mergeResult: { external_execution: JSON.parse(serialized), lease_receipt: receipt },
    });
    if (outcome.rowCount !== 1) { await db.query('ROLLBACK'); return response(409, 'lease_lost'); }
    await db.query(`UPDATE task_leases SET released_at=clock_timestamp(), release_reason='external_worker_finished'
      WHERE task_id=$1 AND claimer=$2 AND claimed_at=$3::timestamptz AND released_at IS NULL`, [taskId, claimer, claimEpoch]);
    await db.query('COMMIT'); committed = true;
  } catch (error) {
    if (!committed) await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); }
  // Follow-up tasks/notifications must never run inside the terminal transaction.
  try { await afterTransition(pool, taskId, status); }
  catch (error) { console.warn(`[task-lease-finish] committed receipt; follow-up unavailable: ${error.message}`); }
  return { status: 200, body: { ok: true, task_id: taskId, status, replayed: false, receipt } };
}
