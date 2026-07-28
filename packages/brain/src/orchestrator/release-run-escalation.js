import { createHash } from 'node:crypto';

function dedupKey(value) {
  return createHash('sha256').update(JSON.stringify([
    value.run_id,
    value.task_id,
    value.release_run_id ?? null,
    value.release_state ?? null,
    value.detail,
  ])).digest('hex');
}

export function createReleaseBlockedEscalator({ pool, raiseAlert }) {
  async function recordDeliveryAttempt(outboxId, outcome, errorCode = null) {
    await pool.query(
      `INSERT INTO kernel_release_alert_delivery_attempts
         (outbox_id, attempt_no, outcome, error_code)
       SELECT $1,
              COALESCE(MAX(attempt_no), 0) + 1,
              $2,
              $3
         FROM kernel_release_alert_delivery_attempts
        WHERE outbox_id = $1
       RETURNING id`,
      [outboxId, outcome, errorCode],
    );
  }

  async function flushPending({ dedup_key: onlyDedupKey = null, limit = 25 } = {}) {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 25, 100));
    const pending = await pool.query(
      `SELECT outbox.id AS outbox_id,
              outbox.severity,
              outbox.alert_key,
              outbox.alert_message
         FROM kernel_release_alert_outbox outbox
         JOIN kernel_release_blocked_escalations escalation
           ON escalation.id = outbox.escalation_id
        WHERE ($1::text IS NULL OR escalation.dedup_key = $1)
          AND NOT EXISTS (
            SELECT 1
              FROM kernel_release_alert_delivery_attempts attempt
             WHERE attempt.outbox_id = outbox.id
               AND attempt.outcome = 'delivered'
          )
        ORDER BY outbox.created_at, outbox.id
        LIMIT $2`,
      [onlyDedupKey, boundedLimit],
    );
    if (pending.rows.length === 0) return { delivery: 'none', attempted: 0 };

    let failed = 0;
    for (const alert of pending.rows) {
      try {
        await raiseAlert(alert.severity, alert.alert_key, alert.alert_message);
        await recordDeliveryAttempt(alert.outbox_id, 'delivered');
      } catch {
        failed += 1;
        await recordDeliveryAttempt(
          alert.outbox_id,
          'failed',
          'alert_delivery_failed',
        );
      }
    }
    return {
      delivery: failed === 0 ? 'delivered' : 'pending',
      attempted: pending.rows.length,
      failed,
    };
  }

  async function escalateReleaseBlocked(value) {
    const key = dedupKey(value);
    const alertKey = `kernel_release_blocked_${value.release_run_id ?? value.run_id}`;
    const alertMessage = `Kernel ReleaseRun BLOCKED: ${value.detail} `
      + `(run=${value.run_id}, release=${value.release_run_id ?? 'unmaterialized'})`;
    const inserted = await pool.query(
      `WITH escalation AS (
         INSERT INTO kernel_release_blocked_escalations
           (run_id, task_id, release_run_id, release_state, merge_sha,
            severity, detail, dedup_key, evidence)
         VALUES ($1, $2, $3, $4, $5, 'P0', $6, $7, $8::jsonb)
         ON CONFLICT (dedup_key) DO NOTHING
         RETURNING id
       ),
       outbox AS (
         INSERT INTO kernel_release_alert_outbox
           (escalation_id, severity, alert_key, alert_message)
         SELECT id, 'P0', $9, $10
           FROM escalation
         RETURNING id, escalation_id
       )
       SELECT escalation.id AS escalation_id,
              outbox.id AS outbox_id
         FROM escalation
         JOIN outbox ON outbox.escalation_id = escalation.id`,
      [
        value.run_id,
        value.task_id,
        value.release_run_id ?? null,
        value.release_state ?? null,
        value.merge_sha ?? null,
        value.detail,
        key,
        JSON.stringify({ source: 'kernel_report_release_gate' }),
        alertKey,
        alertMessage,
      ],
    );
    const delivery = await flushPending({ dedup_key: key, limit: 1 });
    return {
      deduped: !inserted.rows[0],
      escalation_id: inserted.rows[0]?.escalation_id,
      dedup_key: key,
      delivery: delivery.delivery,
    };
  }

  escalateReleaseBlocked.flushPending = flushPending;
  return escalateReleaseBlocked;
}

export const __test__ = { dedupKey };
